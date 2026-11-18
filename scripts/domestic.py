"""Observe public 500/OKOOO Jingcai pages. Never attest official provenance."""
import hashlib
import html
import json
import math
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
from pathlib import Path
import re
from urllib.request import Request, urlopen

BJT = timezone(timedelta(hours=8))
SOURCES = {
    "500": "https://trade.500.com/jczq/index.php?playid=312&g=2",
    "okooo": "https://www.okooo.com/jingcai/",
}
ROOT = Path(__file__).resolve().parent


class Node:
    def __init__(self, tag="", attrs=(), parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children, self.text = [], ""

    def all(self):
        for child in self.children:
            yield child
            yield from child.all()

    def has(self, cls):
        return cls in self.attrs.get("class", "").split()

    def content(self):
        return self.text + " " + " ".join(c.content() for c in self.children)


class Page(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = self.current = Node()
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        child = Node(tag, attrs, self.current)
        self.current.children.append(child)
        if tag not in self.VOID:
            self.current = child

    def handle_startendtag(self, tag, attrs):
        self.current.children.append(Node(tag, attrs, self.current))

    def handle_endtag(self, tag):
        node = self.current
        while node.parent is not None:
            if node.tag == tag:
                self.current = node.parent
                return
            node = node.parent

    def handle_data(self, text):
        self.current.text += text


def clock(text):
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=BJT)


def parse_500(text):
    rows = []
    for node in Page(text).root.all():
        if node.tag != "tr" or not node.has("bet-tb-tr"):
            continue
        a = node.attrs
        active = dict(part.split(":", 1) for part in a.get("data-subactive", "").split(",") if ":" in part)
        try:
            rows.append({"source": "500", "sales_date": a["data-processdate"],
                "match_num": a["data-matchnum"], "league": a.get("data-simpleleague") or a.get("data-league"), "home": a["data-homesxname"], "away": a["data-awaysxname"],
                "kickoff": clock(a["data-matchdate"] + " " + a["data-matchtime"] + ":00").isoformat(),
                "sales_end": clock(a["data-buyendtime"]).isoformat(),
                "provider_event_id": a.get("data-id"), "provider_fixture_id": a.get("data-fixtureid"),
                "available": a.get("data-isend") == "0" and a.get("data-isactive") == "1" and active.get("nspfgg") == "1"})
        except (KeyError, ValueError):
            continue
    return rows


def parse_okooo(text):
    rows = []
    for node in Page(text).root.all():
        if not node.has("touzhu_1") or "data-ordercn" not in node.attrs:
            continue
        group = node.parent
        while group and not group.has("cont"):
            group = group.parent
        if group is None:
            continue
        date_node = next((n for n in group.all() if n.attrs.get("id") == "ChangeDate"), None)
        date_match = re.search(r"\d{4}-\d{2}-\d{2}", date_node.content()) if date_node else None
        # The outcome cells carry team identities even when prices are absent.
        sides = {}
        for child in node.all():
            attrs = child.attrs
            side = attrs.get("data-wz")
            if attrs.get("data-wf") == "0" and side in ("0", "2"):
                if side in sides:
                    raise ValueError("OKOOO duplicate team position")
                sides[side] = child
        try:
            home, away = sides["0"], sides["2"]
            def team(part):
                return next(n.attrs["title"] for n in part.all() if n.has("zhum") and n.attrs.get("title"))
            time_node = next(n for n in node.all() if n.has("shijian"))
            when = re.search(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", time_node.attrs.get("title", ""))
            if not date_match or not when:
                continue
            rows.append({"source": "okooo", "sales_date": date_match.group(),
                "match_num": node.attrs["data-ordercn"], "home": team(home), "away": team(away),
                "kickoff": clock(when.group()).isoformat(), "provider_fixture_id": node.attrs.get("data-mid"),
                "available": node.attrs.get("data-end") == "0"})
        except (KeyError, StopIteration, ValueError):
            continue
    return rows


def reconcile(left, right, now):
    today = now.astimezone(BJT).date().isoformat()
    def key(r):
        return r["sales_date"], r["match_num"]
    def index(rows):
        result = {}
        for row in rows:
            if row["sales_date"] != today:
                continue
            if key(row) in result:
                raise ValueError("Duplicate sales-date / Jingcai-number identity")
            result[key(row)] = row
        return result
    a, b = index(left), index(right)
    matched, gaps = [], []
    weekday = "一二三四五六日"[now.astimezone(BJT).weekday()]
    for k in sorted(set(a) | set(b)):
        x, y = a.get(k), b.get(k)
        reason = None
        if not x or not y:
            reason = "missing_second_source"
        elif not re.fullmatch("周" + weekday + r"\d{3}", k[1]):
            reason = "invalid_jingcai_number"
        elif any("\ufffd" in str(row[field]) for row in (x, y) for field in ("home", "away", "match_num")):
            reason = "undecodable_fixture_identity"
        elif not x["available"] or not y["available"]:
            reason = "not_reported_available_by_both"
        elif any(x[f] != y[f] for f in ("home", "away", "kickoff")):
            reason = "fixture_identity_conflict"
        elif datetime.fromisoformat(x["kickoff"]) <= now or datetime.fromisoformat(x["sales_end"]) <= now:
            reason = "kickoff_or_sales_deadline_passed"
        if reason:
            gaps.append({"sales_date": k[0], "match_num": k[1], "reason": reason})
        else:
            matched.append({"sales_date": k[0], "match_num": k[1], "home": x["home"], "away": x["away"],
                "kickoff": x["kickoff"], "reported_sales_end": x["sales_end"],
                "observed_at": now.isoformat(), "formal_eligible": False,
                "official_verification": "NOT_VERIFIED", "sources": [x, y]})
    return matched, gaps


def render_report(payload):
    def cell(value):
        return html.escape(str(value)).replace("|", "／").replace("\n", " ")
    lines = ["# 当日竞彩页面交叉观察", "",
        f"销售日：{payload['sales_date']}；实际观察时间：{payload['observed_at']}。", "",
        "状态：预分析输入。来源为500/澳客转述，官方未核验，不是正式分析或投注推荐。",
        "| 竞彩编号 | 对阵 | 开球（北京时间） |",
        "|---|---|---|"]
    for row in payload["matches"]:
        values = [row["match_num"], row["home"] + " vs " + row["away"], row["kickoff"]]
        lines.append("| " + " | ".join(cell(v) for v in values) + " |")
    if not payload["matches"]:
        lines += ["", "没有通过当前销售日、身份、时间与两站赛程一致性检查的候选。"]
    lines += ["", "## 来源与缺口", ""]
    for source in payload["sources"]:
        lines.append(f"- {cell(source['source'])}：{cell(source['status'])}；{source['url']}")
    for gap in payload["gaps"]:
        lines.append(f"- {cell(gap.get('match_num', '来源'))}：{cell(gap['reason'])}")
    lines += ["", "一致候选仍不具备正式分析资格；伤停、阵容、独立模型及完整认证需另行完成。", ""]
    return "\n".join(lines)


def decode_html(raw, declared_charset=None):
    # GB2312 labels on Chinese legacy pages commonly contain GBK/GB18030 bytes.
    # Replacement is permitted only in the document shell; fixture identities
    # containing it are rejected by reconciliation, never matched as valid teams.
    charset = (declared_charset or "gb18030").lower().replace("_", "-")
    if charset in {"gb2312", "gb-2312", "gbk", "cp936"}:
        charset = "gb18030"
    text = raw.decode(charset, errors="replace")
    return text, text.count("\ufffd")


def retain_response(root, source, url, raw, charset, observed_at, response_url):
    """Retain exact public response bytes; never replace an earlier capture."""
    if source not in SOURCES or url != SOURCES[source]:
        raise ValueError("Unknown domestic evidence source")
    digest = hashlib.sha256(raw).hexdigest()
    relative = Path("reports/domestic/raw") / source / (digest + ".html")
    path = root / relative
    metadata = path.with_suffix(".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    first = {"source": source, "url": url, "response_url": response_url,
             "path": str(relative), "sha256": digest, "charset": charset,
             "first_seen_at": observed_at.isoformat()}
    if path.exists() or metadata.exists():
        if not path.is_file() or not metadata.is_file():
            raise ValueError("Incomplete domestic evidence pair")
        saved = json.loads(metadata.read_text(encoding="utf-8"))
        if (hashlib.sha256(path.read_bytes()).hexdigest() != digest
                or any(saved.get(k) != first[k] for k in ("source", "url", "path", "sha256"))):
            raise ValueError("Domestic evidence integrity mismatch")
        first = saved
    else:
        with path.open("xb") as output:
            output.write(raw)
        with metadata.open("x", encoding="utf-8") as output:
            output.write(json.dumps(first, ensure_ascii=False, indent=2) + "\n")
    return {**first, "fetched_at": observed_at.isoformat(),
            "observed_charset": charset, "observed_response_url": response_url}


def fetch_page(url, source, root, evidence):
    request = Request(url, headers={"User-Agent": "JPi-personal-research/1.0", "Accept": "text/html"})
    with urlopen(request, timeout=20) as response:
        raw = response.read(1_500_001)
        if response.status != 200 or len(raw) > 1_500_000:
            raise ValueError("Unexpected status or oversized page")
        charset = response.headers.get_content_charset()
        evidence.update(retain_response(root, source, url, raw, charset,
                                        datetime.now(timezone.utc), response.geturl()))
        text, replacements = decode_html(raw, charset)
        return text, hashlib.sha256(raw).hexdigest(), replacements


def main():
    parsed, health = {}, []
    for name, url in SOURCES.items():
        evidence = {}
        try:
            text, digest, replacements = fetch_page(url, name, ROOT, evidence)
            parsed[name] = (parse_500 if name == "500" else parse_okooo)(text)
            if not parsed[name]:
                raise ValueError("No recognized fixture rows")
            health.append({"source": name, "url": url, "status": "success", "rows": len(parsed[name]), "response_sha256": digest, "document_decode_replacements": replacements, "capture": evidence})
        except Exception as error:
            parsed[name] = []
            health.append({"source": name, "url": url, "status": "failed", "error": type(error).__name__, "capture": evidence or None})
    now = datetime.now(timezone.utc)
    try:
        matched, gaps = reconcile(parsed["500"], parsed["okooo"], now)
    except ValueError:
        matched, gaps = [], [{"reason": "duplicate_or_conflicting_identity"}]
    payload = {"observed_at": now.isoformat(), "sales_date": now.astimezone(BJT).date().isoformat(),
        "source_kind": "THIRD_PARTY_JINGCAI_OBSERVATIONS", "official_verification": "NOT_VERIFIED",
        "formal_eligible": False, "sources": health, "matches": matched, "gaps": gaps,
        "source_observations": parsed,
        "warning": "500/澳客页面转述的竞彩场次仅作交叉核对候选，官方尚未核验。两站可能使用共同上游，不能视为独立官方认证。"}
    folder = ROOT / "reports"
    archive = folder / "domestic" / payload["sales_date"] / (now.strftime("%H%M%S_%fZ") + ".json")
    archive.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    with archive.open("x", encoding="utf-8") as output:
        output.write(serialized)
    (folder / "domestic-latest.json").write_text(serialized, encoding="utf-8")
    (folder / "domestic-latest.md").write_text(render_report(payload), encoding="utf-8")
    print(json.dumps({"matched": len(matched), "gaps": len(gaps),
        "formal_eligible": False, "sources": health}, ensure_ascii=False))
    return 0 if matched and all(h["status"] == "success" for h in health) else 2


if __name__ == "__main__":
    raise SystemExit(main())

