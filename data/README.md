# GitHub 上的交通歷史資料

`history/index.json` 列出已提交日期、位元組大小、SHA-256、方向位置數與觀測數。每日 `YYYY-MM-DD.json` 是可直接 `fetch()` 的 JSON；GitHub Pages 建置將它們複製到 `data/history/`，前端不需要 API 金鑰或常駐伺服器。

## 內容與大小

第一批為 **2026-10-15 臺北市 VD 歷史**。原始全市資料 935,344 筆，TDX Meta 標示 1,358,969,939 bytes，下載 gzip 約 98 MB；完整來源只在被 Git 忽略的 `local-data/tdx/`。

內湖研究範圍（經度 121.54–121.63、緯度 25.045–25.105）保留每 15 分鐘整點實測快照，約 **0.59 MB JSON／日**（gzip 約 0.11 MB；這是實測壓縮大小，不保證 Pages 的傳輸編碼）。95 個時間點、230 個 VD×LinkID 方向位置、21,850 筆方向觀測。00:00 整點沒有符合規則的資料，不補值；有 95 格不代表原始資料連續完整。

- `sensors`：一天共用的測站與方向位置字典。
- `columns`：每筆數值的欄位順序；`sensor` 是字典索引。
- `frames`：`[實際觀測時間, [各方向數值]]`。
- `sources`：不含憑證的官方查詢 URL、下載大小及原始回應 SHA-256。
- `source_statistics`、`counts`：來源總量及跨日、區域外、非抽樣時間等排除數。

**是每 15 分鐘的瞬間快照，不是 15 分鐘平均、累計流量、排隊長度或旅行時間。** 使用 `DataCollectTime` 轉 Asia/Taipei 分日，並以同日歷史靜態資料配對位置。有效活動車道的車速／占有率規則與即時地圖相同；異常值不補零。車流仍為來源區間值，不能乘 15。短於抽樣間距的壅塞可能漏掉。

## Dashboard 方案

本階段選用 **Leaflet＋原生 JavaScript 靜態 dashboard**，沿用已完成的 OSM、方向與色塊回放，直接讀取版本控制中的 JSON。不是另裝一套完整的 BI 產品。

| 方案 | GitHub JSON / Pages | 本次取捨 |
|---|---|---|
| Leaflet＋靜態 JavaScript（採用） | 瀏覽器 fetch；純靜態部署 | 既有互動地圖可直接接資料，無新增後端依賴 |
| Observable Framework | 適合靜態分析報告及資料視覺化 | 若後續需要大量分析頁可再導入；目前重寫地圖收益有限 |
| Streamlit / Dash | 可讀 GitHub 資料，但應用需 Python server | 不適合只用 GitHub Pages 執行互動應用 |

一般日期在選取後才下載；首頁為昨晚／今早比較預載昨天檔案。載入前核對檔案大小和 SHA-256；錯誤顯示讀取失敗，不當成交通順暢。最新快照不因加入舊資料而被替換。可從日期選單選上午／下午時段，也可下載當日 JSON。

## 重現與擴充

環境變數使用 `tdxid` / `tdxsec`，或 `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET`。不要把值寫進程式、JSON、Git 或聊天。

```sh
python scripts/backfill_tdx.py --date 2026-10-15
python scripts/build_pages.py --history
python -m unittest discover -s tests -v
node --test tests/*.test.mjs
```

TDX 歷史查詢排除當天，官方文件標示每天 08:00 更新至昨天。程式核對來源 Meta 筆數以避免 `$top` 截斷；保留原始快取，成功下載不重抓。文件：[TDX 歷史路況 OAS](https://tdx.transportdata.tw/webapi/File/Swagger/V3/4b4708cc-ab49-4037-a896-e24544d51609)。來源為交通部 TDX／臺北市交通管制工程處，使用須遵守 [TDX 使用條款](https://tdx.transportdata.tw/term)及來源資料授權。

初次回補由 Codex 環境執行。`weekly-data.yml` 現已設定台北時間每日 11:23、23:23 自動回補並提交兩週摘要，需另在 Actions 設定 `TDX_CLIENT_ID`／`TDX_CLIENT_SECRET`；Codex 環境變數不會自動傳入。逐日 compact 檔只放 Actions cache，原始下載不進 Git。失敗保留舊摘要，成功後觸發 Pages。MQTT 是另一路即時串流，不是此次歷史檔的來源。設定與資料時效見 [README](../README.md#每日兩次更新上週本週)。

每日檔不覆寫、總量達 100 MB 或單日超過 5 MB 時停止新增，改評估物件儲存或發布資產；不要把大型檔先提交後刪除，Git 歷史仍會保存。按本次大小外推一年約 216 MB JSON，實際以每天測站與資料量為準。GitHub 儲存的是公開設備彙整，沒有公車車牌、乘客紀錄或任何金鑰。

`simulation/experiment.json` 是約 370 KB 的**假設情境實驗**，不是實際交通觀測。含雙通道模型版本、全部輸入、六種情境的逐分鐘排隊／流量、車隊需求與容量敏感度；可用 `node scripts/run_simulation.mjs` 重現。流量單位是小客車當量 PCU，時間總量是 PCU·小時，不是乘客人時。原始 TDX 檔及憑證不包含在這份輸出中。


`weeks/profiles.json` 是方向別VD實測抽樣型態，與兩週摘要同批更新；索引含大小及SHA-256供前端核對。每組至少3個參考工作日、每天10格皆有效，缺格日期整日排除。保留原始Volume與來源雜湊，**沒有換算成完整尖峰車流、入區人數或容量**。模擬頁面將相對型態配合假設總需求與複利成長使用；捷運人次則以既有`metro.json`實測作獨立推估。


## 逐日回放與更新狀態

`history/` 現由半日更新工作同步發布上週與本週的已完成日期，與 `weeks/` 使用相同來源快取；索引列出逐日 bytes／SHA-256，總量限制 20 MB。每日完整歷史不含今天；尚未保存的當日晨峰需等待隔日來源可用。週摘要與回放全部產生成功後才提交 GitHub。舊週逐日檔從目前樹移除，但既有 Git 提交仍保留。

Pages 的 `data/dashboard.json` 額外提供 `collection_status`，查詢 GitHub 的 schedule 事件，區分最近定時觸發、近 30 次紀錄內的成功、無紀錄與未知。推送成功不當成定時執行成功。
