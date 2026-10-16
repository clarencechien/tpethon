# 內湖交通觀測站

公開網站：**https://clarencechien.github.io/tpethon/**

首頁為 OpenStreetMap 瓶頸地圖：方向別 VD、速度／占有率圖層、走廊篩選、熱點排序與證據、公車實體站點、捷運歷史需求、來源時間及快照回放。紅點是待查熱點，不宣稱已證明瓶頸成因。

```sh
python scripts/build_pages.py --history
python app.py
```

`_site/` 是靜態網站輸出；也可用 `python -m http.server 8000 --directory _site` 啟動。`python app.py` 優先提供已建好的 `_site`，並保留 `/legacy.html` 的舊 CSV 匯入 dashboard 與 API。

## GitHub Pages 與更新

`.github/workflows/pages.yml` 在 main 推送、手動執行及每小時第 7、22、37、52 分啟動：測試 → 擷取公開交通資料 → 保留前次公開網站的歷史 → 建置 → Pages 部署。需要將 Pages Source 設為 GitHub Actions，工作流程具 pages:write、id-token:write；公開資料不需額外 API 金鑰。

GitHub 排程可能延遲、停用或失敗，不是有 SLA 的即時服務。網頁每五分鐘重新讀取已發布快照，每分鐘重算過期狀態；重新讀取不會即時呼叫政府 API。超過 10 分鐘的道路／公車資料明確標為過期。歷史最多保留 7 天且不超過 336 筆（15 分鐘採樣約 3.5 天），依來源時間去重；失敗擷取保留缺口。首次可用 `--seed-archive local-data/research` 匯入已有實測快照；若前次網站因網路／解析錯誤不可讀取，停止建置並保留已發布版本，避免洗掉累積歷史；僅首次發布的 404 允許從已驗證的種子觀測開始。

Leaflet 1.9.4 已以 npm SHA-512 integrity 驗證後存入 `static/vendor/leaflet`，保留原授權。OSM 使用標準 `tile.openstreetmap.org` 圖磚及可見署名，不預抓整區圖磚；流量增大時須依 [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) 使用合適供應商。圖磚失敗顯示警告，不隱藏觀測資料。捷運圖示為站中心概略位置，非出入口／步行路徑。

判讀採方向別 LinkID，不把同一 VD 不同方向混平均；空車道零車速不當壅塞；低速 <20 km/h 且占有率 ≥25% 列為待查熱點，這是未校正的探索門檻。單一快照不證明持續排隊；歷史證據僅報前一小時有效／符合門檻的離散觀測次數。各方向同位置的圖示只做螢幕像素偏移，資料座標不改動。歷史道路回放不會把最新公車 ETA 偽裝成歷史資料。

額外測試：`node --test tests/map_logic.test.mjs`；瀏覽器整合測試 `python tests/pages_smoke.py`（先建置並在 port 8001 提供 `_site`）。

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


## 日期回放與熱區比較

首頁預設為約 400 公尺熱區色塊，可切換方向別觀測點或兩者疊合。色塊只聚合格內有效方向觀測，不是實際道路／排隊範圍；沒有觀測的地方不插值、不上色。熱點顏色與強度依格內觀測占比，避免只因感測器較密集就顯得更塞；同格不同方向可能不同，需用方向篩選與觀測點核對。

「今天上班」選臺北日期 07:00–09:30；「昨天下班」選前一天 17:00–19:30，也可自行選日期及離峰 10:00–16:00／全日。這些是探索用預設觀測窗，不宣稱已校正為所有企業的實際尖峰。

每 15 分鐘格顯示該格中實際快照的低速方向觀測占比（速度 <20 km/h）；不是連續十五分鐘的壅塞時間，也不是車輛／道路面積比例。格內快照先等權平均，再將有資料的時間格等權平均，避免高頻採樣的某格偏重。異常、過期、空車道不當成順暢；無有效觀測顯示斜線與未知。比較卡附涵蓋格數；兩個時段未各達八成時間格時，不判斷誰較塞，達到後仍需核對同一走廊、方向與樣本組成。

逐筆播放只切換已取得的來源時間，明示相鄰快照時間差；中間缺口不補車況。最新已發布快照與歷史回放分開判讀：歷史觀測以當時擷取時間檢查有效性，最新快照依目前時間判斷過期。

**2026-10-16 開始的觀測沒有涵蓋 10/15 下班與 10/16 07:00–09:30，因此目前無法回放這兩個時段。** 更新介面不會創造過去資料；必須持續累積或取得另外的官方歷史資料，才能比較後續上下班。

## 交通分析研究與更多資料

[內湖交通研究報告](docs/research/NEIHU_RESEARCH.md)整理已取得的 VD 車道歷史、公車 GPS／路線軌跡／站點、捷運來源 OD 分析，以及文獻核對程度、缺漏資料和改善試辦設計。

```sh
python scripts/collect_transport.py
python scripts/collect_transport.py --dynamic-only
python scripts/analyze_metro_od.py
```

採集為單次操作，沒有自動常駐；資料保存於 Git 忽略的 `local-data/research/`。目前只驗證兩次歷史採樣，尚不具備完整晨尖峰歷史。參見研究報告中的限制與排程注意事項。
