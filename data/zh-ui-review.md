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
| `info.relief.what.2` | Slide to the Ice Age: the sea goes down and new land appears. The dashed line is today's coast. | 滑到冰河時期：海水退下去，露出新的陸地。虛線是現在的海岸線。 | Globe, Topography: "What am I looking at?", the second line |
| `unit.m` | m | 公尺 | Globe, Topography: the sea level between Today and the Ice Age (−60 公尺) |
| `info.relief.key.shallow` | Shallow sea | 淺海 | Globe, Topography: the key (the lightest sea) |
| `info.relief.key.deep` | Deep sea | 深海 | Globe, Topography: the key (the darkest sea) |
| `layer.depth.play` | Play the currents | 播放洋流 | Globe, Ocean depth: ▶ (read out) |
| `layer.depth.pause` | Pause | 暫停 | Globe, Ocean depth: ⏸ (read out) |
| `info.depth.key.warm` | Warm current | 暖流 | Globe, Ocean depth: the key |
| `info.depth.key.cold` | Cold current | 涼流 | Globe, Ocean depth: the key (涼流 as in Taiwan textbooks, or 寒流?) |
| `current.kuroshio` | Kuroshio | 黑潮 | Globe, Ocean depth: the name shown when a current is tapped |
| `current.oyashio` | Oyashio | 親潮 | Globe, Ocean depth: the name shown when a current is tapped (or 千島涼流?) |
| `current.gulfStream` | Gulf Stream | 墨西哥灣流 | Globe, Ocean depth: the name shown when a current is tapped |
| `current.northAtlanticDrift` | North Atlantic Drift | 北大西洋暖流 | Globe, Ocean depth: the name shown when a current is tapped |
| `current.labrador` | Labrador Current | 拉布拉多涼流 | Globe, Ocean depth: the name shown when a current is tapped (cold currents: 涼流 as in Taiwan textbooks, or 寒流?) |
| `current.canary` | Canary Current | 加那利涼流 | Globe, Ocean depth: the name shown when a current is tapped |
| `current.benguela` | Benguela Current | 本吉拉涼流 | Globe, Ocean depth: the name shown when a current is tapped (本吉拉 or 本格拉?) |
| `current.agulhas` | Agulhas Current | 阿古拉斯暖流 | Globe, Ocean depth: the name shown when a current is tapped (阿古拉斯 or 厄加勒斯?) |
| `current.brazil` | Brazil Current | 巴西暖流 | Globe, Ocean depth: the name shown when a current is tapped |
| `current.humboldt` | Humboldt Current | 秘魯涼流 | Globe, Ocean depth: the name shown when a current is tapped (Taiwan usually says 秘魯涼流; also called 洪保德) |
| `current.california` | California Current | 加利福尼亞涼流 | Globe, Ocean depth: the name shown when a current is tapped |
| `current.eastAustralian` | East Australian Current | 東澳暖流 | Globe, Ocean depth: the name shown when a current is tapped |
| `current.antarcticCircumpolar` | Antarctic Circumpolar Current | 南極環流 | Globe, Ocean depth: the name shown when a current is tapped (or 西風漂流?) |
| `current.northEquatorial` | North Equatorial Current | 北赤道洋流 | Globe, Ocean depth: the name shown when a current is tapped (or 北赤道暖流?) |
| `current.southEquatorial` | South Equatorial Current | 南赤道洋流 | Globe, Ocean depth: the name shown when a current is tapped (or 南赤道暖流?) |

Month names in the Day & night clock (Nov, 11月) and the time (14:00) come from the browser (`Intl`), not from this file.
