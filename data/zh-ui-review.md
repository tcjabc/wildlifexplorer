# 介面文字待確認 · App strings to check

New Chinese text in the app's buttons and labels (`lang/zh-TW.json`), written in Traditional Chinese (Taiwan) but not yet checked by a native speaker. Please fix any wording directly in `lang/zh-TW.json` (same key); delete a row here once it is checked.

| Key | English | 中文 | Where it shows |
|---|---|---|---|
| `layer.night.hour` | Time of day | 時間 | Globe, Day & night: the time slider (read out by screen readers) |
| `layer.night.month` | Month | 月份 | Globe, Day & night: the button with the time and month, and its month list |
| `layer.night.play` | Play the day | 播放一整天 | Globe, Day & night: ▶ (read out) |
| `layer.night.pause` | Pause | 暫停 | Globe, Day & night: ⏸ (read out) |
| `layer.night.now` | Now | 現在 | Globe, Day & night: the button that goes back to the real time |

Month names in the Day & night clock (Nov, 11月) and the time (14:00) come from the browser (`Intl`), not from this file.
