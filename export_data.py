import json
from datetime import datetime

def generate_mock_data():
    data = {
        "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "summary": { "total_matches": 10, "ev_positive_count": 3, "model_version": "V17.0" },
        "matches": [
            { "league": "英超", "home": "阿森纳", "away": "切尔西", "prob_home": 0.55, "prob_draw": 0.25, "prob_away": 0.20, "ev_value": 0.08, "recommendation": "主胜 (+EV)" }
        ]
    }
    with open("dashboard_data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print("数据更新成功！")

if __name__ == "__main__":
    generate_mock_data()
