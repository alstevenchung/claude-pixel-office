---
name: pixel-office
description: 修改、除錯或擴充「像素辦公室」專案（把本機 Claude Code 工作階段畫成像素辦公室：狀態動畫、對話框、助手機器人、Git/PR/伺服器/資料庫動畫、HP/MP 用量條、扣血數字、桌面應用程式）時使用。動手前先讀，包含架構、隱私規則、已知的坑、測試方法。
---

# 像素辦公室（Pixel Office）

零依賴（只用 Node.js 內建模組）的本機工具：Claude Code 的 hooks 把狀態送到本機伺服器，網頁用 Canvas 畫成像素辦公室。
**只限本機，沒有任何遠端／網路功能。**（曾做過 Tailscale 遠端版，使用者因安全顧慮要求整個移除；沒有使用者明確要求，不要重新加回。）

## 3D 版（預設畫面）

`web/index.html` + `web/main3d.js` 是 three.js 體素 3D 版（r160，`web/vendor/three.min.js` 內建，**不走 CDN**，維持純本機）。已移除舊的 2D 像素版（使用者明說不要切換、只用 3D）；沒有 WebGL 時頁面只顯示提示。老闆、鞭打、扣血數字、活動動畫的邏輯全在 `main3d.js`。
- 座標沿用 2D 的 320×180 邏輯座標，世界座標 = 邏輯/10（x→x，y→z）；牆在 z=4.1。人物面向 +z，坐著時面向 -z（背對鏡頭）。
- 文字（名字、對話框、「收到！」、扣血數字、老闆台詞）是 DOM 標籤（`#ov`），用 `lab()` 釘在 3D 座標上；不是畫在 canvas。
- 預覽：`node tests/preview.js scenario.json out.png` 預設截 3D（用 SwiftShader 軟體 WebGL）。`tests/boss_logic_test.js` 也是對 3D 頁面跑（透過 `__po.updateBoss`）。
- 3D 頁面在真實視窗裡的效果我（Claude）只用無頭預覽驗證過；改完請使用者實際看過才算數。

## 資料流

```
Claude Code ──hook(stdin JSON)──> hook/send.js ──POST /event──> server/server.js ──SSE /events──> web/ (Canvas)
                                                                     ▲
~/.claude/projects/**/*.jsonl ──> server/usage.js ──/usage, 'spend' SSE──┘
```

| 檔案 | 職責 |
|---|---|
| `hook/send.js` | 讀 hook JSON → 分類 → POST 到 `127.0.0.1:8787`。失敗一律靜默 exit 0，絕不能卡住 Claude |
| `server/server.js` | 只綁 `127.0.0.1`。`POST /event`、`GET /events`(SSE)、`GET /usage`、靜態檔 `web/`。狀態存 `office-state.json`（30 分鐘過期）。每 2.5 秒輪詢 token 總量並廣播 `spend` |
| `server/usage.js` | 增量掃 `~/.claude/projects/**/*.jsonl`（8 天窗口，用 message id 去重）。`summary()`、`sessionTotals()` |
| `web/main3d.js` | three.js 3D 場景：房間、桌位 `DESKS`、人物／助手／老闆、活動動畫、DOM 標籤、扣血數字、鞭打 |
| `web/vendor/three.min.js` | three.js r160（MIT），內建不走 CDN |
| `web/hud.js` | 下方 HP（今日）/ MP（近 7 天）條，每 10 秒更新，`pulseHp()` |
| `usage-config.json` | 每日／每週 token 預算（使用者自訂；剩餘量 = 預算 − 已用，**不是官方額度**） |
| `app.ps1`、`start.bat`、`start-in-browser.bat`、`app.ico` | 桌面應用程式（Edge `--app` 視窗）。桌面有「像素辦公室」捷徑指向 `start.bat` |
| `install.bat` / `uninstall.bat` → `install.ps1` | 給別人用的安裝／移除：**先用白話列出會做什麼、不會做什麼、會送什麼資料，等使用者輸入 Y 才動手**；備份 `~/.claude/settings.json`、加入／移除 9 個 hooks、建立／刪除桌面捷徑。`-Yes` 只給自動測試用 |
| `tools/settings-hooks.js` | 安裝器真正改設定檔的程式（嚴格 JSON、先備份、寫完驗證、失敗還原、可重複執行；只認指向**這個資料夾**的 hook 為自己的） |
| `pack.bat` → `pack.ps1` | 產生要給別人的 `PixelOffice.zip`（預設放桌面）。**白名單**打包（不含 `.app-profile`、`office-state.json`、pack 自己），並掃描個人資訊（作者的使用者名稱、信箱、本機專案路徑、使用者家目錄路徑；實際字樣定義在 `pack.ps1` 的 `$personal`，**說明文件裡不要逐字寫出來**，否則會被自己的掃描擋下），發現就拒絕打包。新增要出貨的檔案時，要把它加進 `pack.ps1` 的 `$include` |
| `tests/` | 測試與預覽工具（見下） |

全域 hooks 在 `~/.claude/settings.json`，已註冊：`SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, SessionEnd, SubagentStart, SubagentStop`，全部指向 `hook/send.js`。（程式也處理 `PermissionRequest`，但**沒有註冊**。）

## 功能清單（使用者要求過的）

- 每個工作階段一個小人，名字 = **專案根目錄名**，名字下方顯示該階段用的模型（各階段獨立）。
- 狀態：coding=打字、thinking=托頭、waiting_approval=舉手揮動＋閃爍紅色驚嘆、idle=在飲水機旁閒逛。
- 對話框：白底黑字、字小、自動換行（最多 3 行）；第二排桌位的往下長；靠右邊緣時翻到左側。
- 助手（subagent）= 小機器人，站在主人桌子**左側**，最多 4 個，其餘顯示 `+N`；主人離開時一起消失。
- Git/GitHub：commit=文件蓋章、push=紙飛機飛向牆上「Git 雲端」、pull=包裹飛下來、**PR=走到右邊紅色 PR 信箱投信**、merge/一般 git/gh 各有圖示。
- 伺服器/資料庫/容器：ssh·scp·rsync=牆上機櫃燈號＋封包＋**顯示主機名**；mysql·psql·sqlcmd·mongosh·redis-cli·sqlite3 等=右下資料庫圓柱＋**顯示主機名**；docker·kubectl=貨櫃堆。
- 用量：HP 條、MP 條；**每次 Claude 回應完成，花掉的 token 在該小人頭上跳 `-1.2K`**（≥5 萬為黃色放大 `-182K!`），HP 條會震動。
- 桌面應用程式：雙擊捷徑／`start.bat` 開獨立視窗；關窗時若伺服器是這次啟動的就一併關閉。
- **純娛樂特效（不影響任何東西、不送任何資料）：**
  - **「收到！」**：使用者送出訊息的瞬間（`UserPromptSubmit` → 伺服器廣播 `prompt` 事件），那個小人跳一下並冒出「收到！」。
  - **老闆（BOSS）**：禿頭、大肚子、紅領帶；從右下角入口走到小人旁邊，對話框紅框碎念罐頭台詞、小人冒汗，約 5.5 秒後走掉。送出訊息時有機率出現；**單次花超過 5 萬 token 一定出現**。可調參數在 `web/main3d.js` 開頭：`BOSS_CHANCE`（0.5）、`BOSS_COOLDOWN_MS`（45000）、`BOSS_SPEND_MIN`（50000）；台詞在 `BOSS_LINES`／`BOSS_SPEND_LINES`。
  - **訊息在排隊 → 老闆一直碎念到被處理**：使用者在 Claude 還在忙時又送出訊息，Claude Code 會在對話紀錄寫 `queue-operation`（`enqueue` 進佇列；Claude 取用時是 `remove`（中途插入）或 `dequeue`（下一輪處理））。`server/usage.js` 用**文字比對**只取出動作字＋sessionId（**不解析 `content`，那是使用者的訊息**），`server/server.js` 每秒統計每個工作階段的排隊數並廣播 `{type:'waiting', id, n}`。頁面：`n>0` → 老闆**快步**衝去、`hold`（一直待著、台詞每 3.2 秒換一句、小人頭上「等待處理中…」），`n` 回到 0 → 小人「收到！」、老闆走（若另一個人還在等就先去找他）。**不要再用「UserPromptSubmit 時工作階段是不是忙」來猜**，那不準。
  - **鞭打**：滑鼠點小人（或助手機器人）→ 鞭子從右上甩下「啪！」，小人抖動、冒星星、喊「哎呀！」等。點老闆本人他會罵「你敢鞭打老闆！？」。使用者明說這「沒有任何意義」：純畫面效果，別讓它去影響狀態或送出任何東西。

## 隱私規則（不可破壞）

hook **只能**送出：session id、專案資料夾名、狀態、`action` 描述（檔案 base name，或 Claude 自己寫的指令 `description`，或固定標籤）、activity 類別、**僅限 ssh/db/kubectl 的主機名**、模型 id、parent id。
**絕不送**：提示詞、指令本身、參數、使用者名稱、密碼、連線字串、SQL、連接埠、路徑、檔案內容、工具輸出。
`tests/hook_classify_test.js` 會用假密碼驗證，改 hook 後必跑。
**提示詞本身絕不能被讀取或轉送。** Claude Code 的 hook 輸入裡有 `prompt`（使用者打的字），`send.js` 只送一個布林旗標 `prompt: true`，伺服器只轉發 `{type:'prompt', id}`；老闆的台詞是**預先寫死的罐頭台詞**，與使用者輸入無關。`tests/prompt_event_test.js` 用假的提示詞文字驗證它不會出現在伺服器送出的任何資料裡。伺服器另外：只接受 Host 為 localhost、拒絕帶 `Origin` 的 POST、`/event` 上限 4KB、路徑穿越檢查。

## 已知的坑（都真的踩過）

1. **名字要用 `CLAUDE_PROJECT_DIR`，不能用 hook 的 `cwd`。** Claude 一 `cd e2e`，`cwd` 就變成子資料夾，角色名會在專案名／子資料夾名之間跳。`send.js` 已用 `process.env.CLAUDE_PROJECT_DIR || h.cwd`。
2. **`node --check` 抓不到執行期錯誤。** 曾因區域變數 `target` 蓋掉匯入的函式 `target()`（TDZ）導致 hook 一執行就當掉、小人全部不動，語法檢查卻是綠的。改 hook 後一定跑 `tests/hook_classify_test.js`。
3. **事件動畫的時鐘要統一。** 由事件產生的效果（扣血數字）用 `performance.now()` 記時間，並且 `age` 要處理負值；用 rAF 的 `t` 混搭會讓 `age` 變負、彈出縮放爆成滿版黑塊。
4. **改 `send.js` 立即生效**（每個事件都重新執行）；**改 `settings.json` 的 hooks，已開著的 Claude 視窗要重開**才會載入。
5. **改了 `server/*.js` 必須重啟伺服器。** 用桌面應用程式時：關掉視窗（會停伺服器）再執行 `start.bat`。
6. **`app.ps1` 必須維持純 ASCII；`install.ps1` 必須是「UTF-8 含 BOM」。** Windows PowerShell 5.1 會把無 BOM 的檔案當 ANSI 讀：中文會變亂碼。`install.ps1` 有中文訊息所以要 BOM（Write 工具寫完後要補 BOM），`app.ps1` 沒有中文所以保持 ASCII。另外 PowerShell 5.1 讀 Node 寫出的無 BOM UTF-8 檔也會顯示亂碼，只是顯示問題；要驗證內容請用 Node 讀。
6b. **改別人的設定檔一律用 `tools/settings-hooks.js`，不要用 PowerShell 的 `ConvertTo-Json`**（深度預設只有 2、會改寫格式與跳脫字元）。安裝／移除的說明文字要與實際行為一致，改行為時同步改 `install.ps1` 的說明。
7. **瀏覽器 MCP 截這個頁面會一直逾時**（SSE 長連線）。改用 `tests/preview.js`（無頭瀏覽器＋假資料）。
8. **在 Git Bash 用 heredoc 塞大段 JS 會被引號搞壞。** 改用 Write 工具寫檔，再用「標記必須恰好出現一次」的小補丁腳本修改，找不到就丟錯，不要硬寫。
9. **不要把假資料寫進真實的 `~/.claude/projects`。** 測試一律用假的家目錄（見 `tests/spend_test.js`）。
10. 用量「已用」= 輸入 + 輸出 + 快取寫入；**快取讀取不算**（便宜且量大，會讓數字失真）。助手的訊息與主角共用 session id，所以它們花的 token 算在主角頭上；工作階段所用模型只取非 sidechain 的訊息。
11. **寫測試腳本的兩個陷阱（在這台 Windows 上）：** ① `fs.cpSync` 的來源路徑含中文時，node 會無聲地以 exit 127 當掉（沒有任何錯誤訊息），要複製資料夾請用 `readdirSync` + `copyFileSync` 自己遞迴。② 不要用 PowerShell 5.1 的管線（`$json | node hook\send.js`）餵 hook 的 stdin 來驗證，它的編碼行為會讓事件悄悄沒送到；要用 Node 的 `execFile(...).stdin.end(json)`（和 Claude Code 實際餵法一致，見 `tests/hook_classify_test.js`）。另外 PowerShell 工具對含 `Remove-Item` 與字面 `'\n'` 的長指令會誤判為危險路徑而擋下，清理暫存檔請獨立一個指令。
12. **出貨前一定用 `pack.bat` 的產出驗證，不要手動壓縮。** 驗證方式：解壓縮到另一個含空格與中文的路徑 → 跑 `install.ps1 -Yes -SettingsPath <假檔> -DesktopPath <假資料夾>` → 用該份的 server 與 hook 走一遍事件流程（不要碰真正的 `~/.claude`）。

## 版面地圖（320×180 邏輯座標，畫布放大 4 倍）

牆面（y<41）：書架(2..16)、窗戶(24/104/184)、**伺服器機櫃(150,5)**、**Git 雲端(230..256)**、時鐘(258)、白板(282)。
右側：植物(306,60)、**PR 信箱(296..310, 72..98)**、飲水機(292,128)、**資料庫圓柱(300,148)**；idle 閒逛區 x262–286, y142–170。
桌位 `DESKS`：上排 y=62，下排 y=122，x = 46/126/206；小人座標 = (d.x+22, d.y+30)。助手站桌子左側（d.x−10…），對話框往右開，所以兩者不會互蓋。新增道具前先對照這張圖，避免被對話框蓋住。

## 擴充一種新的 activity（照這個順序）

1. `hook/send.js`：`ACTIVITY_ORDER`（優先序）、`ACTIVITY_LABEL`、`classify()`。需要主機名就用 `hostOnly()`，**不要**把任何其他片段放進 payload。
2. `server/server.js`：把名稱加進 `ACTIVITIES`（有 target 的還要加進 `target` 白名單那行）。
3. `web/main3d.js`：`makeFx()`／`updateFx()` 加動畫；需要道具就在 `buildRoom()` 加（先查版面地圖）。
4. `tests/hook_classify_test.js`：加指令案例＋洩漏檢查字串。
5. 跑測試、跑 `tests/preview.js` 看畫面、重啟應用程式。

## 測試與預覽

```
node tests/hook_classify_test.js      # 指令分類 + 隱私（30 多組案例）
node tests/spend_test.js              # 扣血事件端到端（約 25 秒，假家目錄）
node tests/installer_test.js          # 安裝器：用拋棄式設定檔測（不碰真正的 ~/.claude）
node tests/prompt_event_test.js       # 「送出訊息」信號 + 提示詞文字不外洩（假家目錄、假狀態檔）
node tests/waiting_test.js            # 排隊偵測 + 排隊訊息內容不外洩（假家目錄，約 20 秒）
node tests/boss_logic_test.js         # 老闆決策邏輯，用無頭瀏覽器跑真正的頁面（--dump-dom 不跑動畫幀，所以測試裡手動呼叫 drawBoss）
node tests/preview.js scenario.json out.png   # 用假資料截圖（說明在檔案開頭）
```

預覽 scenario 還支援：`"events":[{"type":"prompt","id":"1","at":4900}]`（收到的跳躍）、`"bossShow":{"id":"1","line":"…"}`（老闆已站在旁邊碎念）、`"whip":[{"id":"2","at":4800}]`（鞭打瞬間）。測試用伺服器請設環境變數 `PIXEL_OFFICE_STATE=<假檔路徑>`，避免寫到真正的 `office-state.json`。
預覽 scenario 範例：`{"agents":[{"id":"1","name":"Shop","state":"coding","action":"提交 PR","activity":"pr"}],"spend":[{"id":"1","tokens":3703,"at":4400}]}`

收尾檢查：`node --check` 每個改過的 js → 跑上面兩個測試 → 預覽截圖看一眼 → 關窗再 `start.bat`。
**實際在使用者開著的視窗裡看到的，才算驗證；只用預覽或模擬事件驗證時，回報要明講。**
