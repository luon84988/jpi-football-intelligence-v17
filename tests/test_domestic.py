import copy
from datetime import datetime, timezone
import unittest

from scripts.domestic import parse_500, parse_okooo, reconcile, odds, decode_html, compare_hhad, render_report

NOW = datetime(2026, 10, 29, 7, 0, tzinfo=timezone.utc)
FIVE = '''<table><tr class="bet-tb-tr" data-processdate="2026-10-29" data-matchnum="周四001"
data-homesxname="甲队" data-awaysxname="乙队" data-matchdate="2026-10-30" data-matchtime="01:00"
data-buyendtime="2026-10-29 22:00:00" data-isend="0" data-isactive="1" data-subactive="nspfgg:1"
data-id="123"><td><p data-type="nspf" data-value="3" data-sp="2.10"></p>
<p data-type="nspf" data-value="1" data-sp="3.20"></p><p data-type="nspf" data-value="0" data-sp="3.10"></p>
<p data-type="spf" data-value="3" data-sp="9.00"></p></td></tr></table>'''
OK = '''<div class="cont"><div id="ChangeDate"><a>2026-10-29 星期四</a><ul><li>2026-10-28</li></ul></div>
<div class="touzhu_1" data-ordercn="周四001" data-end="0" data-mid="456">
<div class="shijian" title="比赛时间:2026-10-30 01:00:00">22:00</div>
<div data-wf="0" data-wz="0" data-sp="2.10"><div class="zhum" title="甲队"></div></div>
<div data-wf="0" data-wz="1" data-sp="3.20"></div>
<div data-wf="0" data-wz="2" data-sp="3.10"><div class="zhum" title="乙队"></div></div>
<div data-wf="1" data-wz="0" data-sp="9.00"></div></div></div>'''


class DomesticTests(unittest.TestCase):
    def setUp(self):
        self.left, self.right = parse_500(FIVE), parse_okooo(OK)

    def test_parsers_keep_handicap_market_and_sign_separate(self):
        five = FIVE.replace('data-id="123"', 'data-rangqiu="+1" data-id="123"').replace(
            'data-subactive="nspfgg:1"', 'data-subactive="nspfgg:1,spfgg:1"').replace(
            '</td></tr>', '<p data-type="spf" data-value="1" data-sp="4.00"></p><p data-type="spf" data-value="0" data-sp="1.10"></p></td></tr>')
        ok = OK.replace('data-end="0"', 'data-end="0" data-rq="1"').replace(
            '<div data-wf="1" data-wz="0" data-sp="9.00"></div>',
            '<div data-wf="1" data-wz="0" data-sp="9.00"></div><div data-wf="1" data-wz="1" data-sp="4.00"></div><div data-wf="1" data-wz="2" data-sp="1.10"></div>')
        left, right = parse_500(five), parse_okooo(ok)
        rows, gaps = reconcile(left, right, NOW)
        self.assertEqual(gaps, [])
        self.assertEqual(rows[0]["reported_sp"], ["2.10", "3.20", "3.10"])
        self.assertEqual(rows[0]["hhad"], {"status": "cross_checked", "home_handicap": 1, "reported_sp": ["9.00", "4.00", "1.10"]})

    def test_handicap_sign_conflict_never_borrows_other_market(self):
        left = {"hhad_available": True, "handicap": 1, "hhad_odds": ["2", "3", "4"]}
        right = dict(left, handicap=-1)
        self.assertEqual(compare_hhad(left, right)["reason"], "hhad_line_conflict")
        right = dict(left, hhad_odds=["2.01", "3", "4"])
        self.assertEqual(compare_hhad(left, right)["reason"], "hhad_sp_conflict")

    def test_absent_handicap_does_not_invent_line_or_prices(self):
        row = reconcile(self.left, self.right, NOW)[0][0]
        self.assertEqual(row["hhad"]["status"], "gap")
        self.assertNotIn("reported_sp", row["hhad"])
        self.assertNotIn("home_handicap", row["hhad"])
        self.assertFalse(row["formal_eligible"])

    def test_readable_report_escapes_external_team_names(self):
        row = reconcile(self.left, self.right, NOW)[0][0]
        row["home"] = '<script>alert(1)</script>|甲队'
        report = render_report({"sales_date": "2026-10-29", "observed_at": NOW.isoformat(), "matches": [row], "sources": [], "gaps": []})
        self.assertNotIn('<script>', report)
        self.assertIn('&lt;script&gt;', report)
        self.assertIn('hhad_not_available_by_both', report)
        self.assertIn('官方未核验', report)

    def test_legacy_charset_superset_handles_extended_chinese(self):
        text, replacements = decode_html("甲𠮷乙".encode("gb18030"), "gb2312")
        self.assertEqual(text, "甲𠮷乙")
        self.assertEqual(replacements, 0)
        text, replacements = decode_html(b"<aside>\x80</aside>" + FIVE.encode("gb18030"), "gbk")
        self.assertEqual(replacements, 1)
        self.assertEqual(len(parse_500(text)), 1)

    def test_undecodable_team_never_becomes_a_confirmed_match(self):
        for row in self.left + self.right:
            row["home"] = "甲\ufffd队"
        rows, gaps = reconcile(self.left, self.right, NOW)
        self.assertEqual(rows, [])
        self.assertEqual(gaps[0]["reason"], "undecodable_fixture_identity")

    def test_reads_correct_market_and_overnight_sales_date(self):
        rows, gaps = reconcile(self.left, self.right, NOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual(gaps, [])
        self.assertEqual(rows[0]["reported_sp"], ["2.10", "3.20", "3.10"])
        self.assertEqual(rows[0]["sales_date"], "2026-10-29")
        self.assertTrue(rows[0]["kickoff"].startswith("2026-10-30"))
        self.assertFalse(rows[0]["formal_eligible"])
        self.assertEqual(rows[0]["official_verification"], "NOT_VERIFIED")

    def test_odds_conflict_does_not_choose_a_winner(self):
        self.right[0]["odds"][0] = "2.11"
        rows, gaps = reconcile(self.left, self.right, NOW)
        self.assertEqual(rows, [])
        self.assertEqual(gaps[0]["reason"], "sp_conflict")

    def test_missing_source_is_a_gap(self):
        rows, gaps = reconcile(self.left, [], NOW)
        self.assertEqual(rows, [])
        self.assertEqual(gaps[0]["reason"], "missing_second_source")

    def test_same_number_cannot_hide_a_different_fixture(self):
        self.right[0]["away"] = "丙队"
        rows, gaps = reconcile(self.left, self.right, NOW)
        self.assertEqual(rows, [])
        self.assertEqual(gaps[0]["reason"], "fixture_identity_conflict")

    def test_closed_or_not_selling_market_is_rejected(self):
        for side in (self.left, self.right):
            changed = copy.deepcopy(side)
            changed[0]["available"] = False
            rows, gaps = reconcile(changed if side is self.left else self.left,
                                   changed if side is self.right else self.right, NOW)
            self.assertEqual(rows, [])
            self.assertEqual(gaps[0]["reason"], "not_reported_available_by_both")

    def test_yesterday_is_not_backfilled_as_today(self):
        for row in self.left + self.right:
            row["sales_date"] = "2026-10-28"
        self.assertEqual(reconcile(self.left, self.right, NOW), ([], []))

    def test_sales_cutoff_or_kickoff_blocks_late_observations(self):
        for field in ("sales_end", "kickoff"):
            left, right = copy.deepcopy(self.left), copy.deepcopy(self.right)
            left[0][field] = "2026-10-29T14:59:00+08:00"
            if field == "kickoff":
                right[0][field] = left[0][field]
            rows, gaps = reconcile(left, right, NOW)
            self.assertEqual(rows, [])
            self.assertEqual(gaps[0]["reason"], "kickoff_or_sales_deadline_passed")

    def test_duplicate_identity_is_not_first_row_wins(self):
        with self.assertRaises(ValueError):
            reconcile(self.left * 2, self.right, NOW)

    def test_invalid_odds_and_wrong_weekday_are_rejected(self):
        for value in ("NaN", "inf", "0", "1", "未开售"):
            self.assertIsNone(odds([value, "2", "3"]))
        for row in self.left + self.right:
            row["match_num"] = "周三001"
        self.assertEqual(reconcile(self.left, self.right, NOW)[1][0]["reason"], "invalid_jingcai_number")


if __name__ == "__main__":
    unittest.main()

