# 介面文字待確認 · App strings to check

New Chinese text in the app's buttons and labels (`lang/zh-TW.json`), written in Traditional Chinese (Taiwan) but not yet checked by a native speaker. Please fix any wording directly in `lang/zh-TW.json` (same key); delete a row here once it is checked.

| Key | English | 中文 | Where it shows |
|---|---|---|---|
| `layer.night.hour` | Time of day | 時間 | Globe, Day & night: the time slider (read out by screen readers) |
| `layer.night.month` | Month | 月份 | Globe, Day & night: the button with the time and month, and its month list |
| `layer.night.play` | Play the day | 播放一整天 | Globe, Day & night: ▶ (read out) |
| `layer.night.pause` | Pause | 暫停 | Globe, Day & night: ⏸ (read out) |
| `layer.night.now` | Now | 現在 | Globe, Day & night: the button that goes back to the real time |
| `layer.relief.today` | Today | 今天 | Globe, Topography: the sea level's label at today's sea |
| `layer.relief.iceAge` | Ice Age | 冰河時期 | Globe, Topography: the sea level's label at its lowest (−120 m) |
| `layer.relief.iceAgeWhen` | about 20,000 years ago | 大約兩萬年前 | Globe, Topography: read out with Ice Age |
| `layer.relief.level` | Sea level | 海平面 | Globe, Topography: the sea level slider (read out) |
| `layer.relief.levelText` | Sea level {n} | 海平面 {n} | Globe, Topography: read out with the level (海平面 −60 公尺) |
| `layer.relief.play` | Play the sea level | 播放海平面的變化 | Globe, Topography: ▶ (read out) |
| `layer.relief.pause` | Pause | 暫停 | Globe, Topography: ⏸ (read out) |
| `unit.m` | m | 公尺 | Globe, Topography: the sea level between Today and the Ice Age (−60 公尺) |

Month names in the Day & night clock (Nov, 11月) and the time (14:00) come from the browser (`Intl`), not from this file.
