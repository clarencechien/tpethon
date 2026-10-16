# 內湖交通觀測站

快速 Actual dashboard：Python 3.12+ 標準函式庫後端、原生 HTML/CSS/JS，無 npm／pip 執行期相依套件。

## 啟動

```sh
cd /workspace/tpethon
python app.py
```

服務使用 port 8000，可透過 `PORT` 覆寫。這是開發用 HTTP server，尚未配置公開部署所需的驗證與 TLS。開發環境已隔離，沿用現有 checkout，無需另建 worktree。

- `GET /api/health`：服務健康狀態。
- `GET /api/live`：VD 與公車即時快照，快取 60 秒，瀏覽器可見時每分鐘更新。
- `GET /api/metro`：本機已彙整的捷運歷史 OD 資料。
- `GET /api/data`：自行匯入的歷史觀測。
- `POST /api/import`：UTF-8 CSV body，最多 10 MB，整份取代；畫面在已有資料時會確認。

## 資料來源與限制

道路：`https://tcgbusfs.blob.core.windows.net/blobtisv/VD.xml` 與 `VDLive.xml`。已驗證 XML 命名空間、VDID、車道速度、各車種流量、Status 與 DataCollectTime。排除舊 `GetVD.xml`：驗證時該來源仍回傳 2024 年資料。範圍為 121.54–121.63°E、25.045–25.105°N，包括內湖周邊聯外走廊，不是內湖行政區邊界。速度為有效車道算術平均；保留原始區間流量，不假設更新頻率等於統計區間，也不將各 VD 流量視為唯一通勤人數。此版本未接高速公路局獨立資料源，不能聲稱完整涵蓋高快速道路。

公車：同網域 `blobbus/GetEstimateTime.gz`、`GetStop.gz`、`GetRoute.gz`。以站點位置、路線 ID 串接，顯示預估到站。負值顯示無有效預估；來源超過 10 分鐘標示過期。不以到站預估推算乘客量、實際班次或擁擠程度。列表最多顯示篩選後 200 筆。

捷運：官方資料集 `63f31c7e-7fc3-418b-bd82-b95158755b4d`。資料頁下載的 CSV 是月份索引，不是 OD 本體。更新指令：

```sh
python metro.py
```

程式從官方索引尋找最新月份，以 HTTPS 串流讀取 `tcgmetro.blob.core.windows.net` 的實際 CSV；保留選定文湖線站點、平日、07/08/09 三個整點時段。OD 的時段是進站時間，「以本站為目的地」不能解讀成該小時實際出站人次。09–10 時保留原始粒度，不虛構 09–09:30 運量。轉乘站的 OD 是站級資料，不足以判斷實際使用哪條線。月資料與即時車流有不同日期，畫面分開標示。`local-data/metro.json` 是可保留的衍生資料，未納入 Git；完整原始月檔不落盤。

所需網域：`tcgbusfs.blob.core.windows.net`、`data.taipei`、`tcgmetro.blob.core.windows.net`。目前公開來源不需金鑰；TDX 尚未啟用，不需填入 TDX 憑證。

## 匯入歷史資料

CSV 欄位：

```text
mode,timestamp,location,metric,value,interval_minutes,source
```

- `mode`：road / bus / metro。
- `metric`：road 使用 vehicles、speed_kph；bus 使用 arrivals、boardings；metro 使用 entries、exits。
- `timestamp`：含時區的區間起點，例如 `2026-10-15T07:00:00+08:00`。
- `interval_minutes`：5、15、60。需對齊區間起點，不可重疊。
- `location`：唯一 VD／站點名稱，勿同時匯入總計與分項。
- `value`：非負有限數；缺漏應省略，不能補零。
- `source`：可追溯的資料來源。使用者須確認匯入內容為實測，程式只驗證格式與一致性。

匯入資料保存於 Git 忽略的 `local-data/observations.json`。歷史篩選只納入完整落在所選時段內的區間，因此 09–10 時小時資料不會算進 07–09:30；小時資料不拆成假造的 15 分鐘值。尚未建立背景 VD 歷史採集器，也未提供規劃、DRTS 最佳化或彈性工時效益估計。

## 驗證

```sh
python -m unittest discover -s tests -v
node --check static/app.js
```

測試涵蓋異常／過期資料、負值公車預估、匯入時區／重複／重疊區間與捷運 OD 彙整。瀏覽器驗證可使用 Playwright 搭配系統 `/usr/bin/chromium`；Python app 本身不依賴 Playwright。

已在目前環境驗證 2026-09 月資料（8,240,400 筆原始 OD），資料留在 `local-data/metro.json`。更新失敗時保留既有成功資料。瀏覽器整合測試需先啟動服務：`python tests/browser_smoke.py`，會測試匯入後還原原有資料；請勿與使用者匯入同時執行。

## 交通分析研究與更多資料

[內湖交通研究報告](docs/research/NEIHU_RESEARCH.md)整理已取得的 VD 車道歷史、公車 GPS／路線軌跡／站點、捷運來源 OD 分析，以及文獻核對程度、缺漏資料和改善試辦設計。

```sh
python scripts/collect_transport.py
python scripts/collect_transport.py --dynamic-only
python scripts/analyze_metro_od.py
```

採集為單次操作，沒有自動常駐；資料保存於 Git 忽略的 `local-data/research/`。目前只驗證兩次歷史採樣，尚不具備完整晨尖峰歷史。參見研究報告中的限制與排程注意事項。
