# 从烧录到 GitHub Pages 上线：完整部署教程

本项目采用“手机网页直连 MixIO + ESP8266 本地执行”的结构。GitHub Pages 只托管静态网页，不保存 MixIO 项目密码、命令签名密钥、计划表或操作记录。定时计划保存在 ESP8266 的 EEPROM 中，手机和网页关闭后仍会运行。

## 1. 当前项目已经准备好的内容

当前工作区已经完成：

- MixIO 用户名、项目名、项目密码和命令签名密钥配置。
- MixIO 项目密码和命令签名密钥写入本机私密 `config.h`。
- Wi-Fi 不写入源码，首次上电通过设备自己的配置热点写入闪存。
- `config.h` 已加入 `.gitignore`，不会提交到 Git。
- 私密 `config.h` 已加入 `.gitignore`，不会上传到 GitHub。
- 网页支持手动投喂、设备状态、最多 6 条定时计划和多手机授权。

你不需要修改固件里的 Wi-Fi 字符串；首次上电按下面的配网步骤填写。不要把私密 `config.h` 发到公开仓库或论坛。

## 2. 安装 Arduino IDE 和开发板

1. 安装 Arduino IDE 2.x。
2. 打开“文件 → 首选项”。
3. 在“附加开发板管理器网址”加入：

```text
https://arduino.esp8266.com/stable/package_esp8266com_index.json
```

4. 打开“工具 → 开发板 → 开发板管理器”。
5. 搜索并安装 `esp8266 by ESP8266 Community` 的稳定 3.x 版本。
6. 打开“库管理器”，安装：

| 库 | 建议版本 |
|---|---|
| ArduinoJson by Benoit Blanchon | 6.21.x，或确认兼容的更新版 |
| PubSubClient by Nick O'Leary | 2.8 或更新稳定版 |

`Servo`、`EEPROM`、`ESP8266WiFi`、NTP 时间和 BearSSL 随 ESP8266 开发板包提供。

## 3. 准备私密固件配置

打开：

```text
firmware/esp8266_fish_feeder/config.h
```

MixIO 信息和命令签名密钥已经在本机私密 `config.h` 中。Wi-Fi 两行保持空字符串即可：

```cpp
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
```

注意：

- ESP8266 只能连接 2.4GHz Wi-Fi。
- Wi-Fi 名称区分大小写。
- 如果路由器把 2.4GHz 和 5GHz 合并为同一名称，一般可以使用；首次联调失败时建议临时分开名称。
- 其他 MixIO 和签名配置已经写好，不要只改固件而不更新授权手机。

## 4. 接线和烧录

首次烧录建议先断开舵机，只连接 NodeMCU USB：

1. 使用支持数据传输的 USB 线连接电脑。
2. Arduino IDE 打开：

```text
firmware/esp8266_fish_feeder/esp8266_fish_feeder.ino
```

3. 开发板选择 `NodeMCU 1.0 (ESP-12E Module)`。
4. 选择正确的 COM 端口。
5. Upload Speed 先选择 `115200`。
6. CPU Frequency 使用 `80 MHz`。
7. Flash Size 使用开发板默认的 4MB 选项即可。
8. 点击“验证”；成功后点击“上传”。
9. 打开串口监视器，波特率选择 `115200`。

首次没有 Wi-Fi 时，串口日志应包含：

```text
Wi-Fi configuration mode
Setup SSID: fish-feeder-xxxx
Open: http://192.168.4.1
```

填写 Wi-Fi 后，设备重启并连接成功时日志应包含：

```text
ESP8266 servo fish feeder starting
Wi-Fi connected, IP: ...
Connecting to MixIO MQTT...
MixIO MQTT connected
```

升级到当前固件时 EEPROM 数据结构会自动初始化一次；如果结构版本变化，旧的测试计数和计划被清空属于正常现象。

## 5. 首次配网和重置配网

1. 烧录后上电，手机连接设备热点 `fish-feeder-xxxx`，密码是 `fish8266`。
2. 打开 `http://192.168.4.1`；若手机弹出“此网络无互联网”，选择继续保持连接。
3. 填写家里的 2.4GHz Wi-Fi 名称和密码，点击“保存并连接”。设备会把信息写入 EEPROM/闪存并自动重启。
4. 以后断电、重启都不需要重新填写。正常联网时，网页状态卡片会显示局域网 IP，点击“打开 Wi-Fi 设置”即可在同一家庭 Wi-Fi 内修改。
5. 如果旧 Wi-Fi 改名或失效，设备尝试约 20 秒后自动开启配置热点。也可以双击 NodeMCU 的 `RST`，或按住 `FLASH` 再按 `RST`，清除旧凭据并进入配网。
6. 配网设置页是局域网管理页；不要把设备热点密码和局域网地址发到公共群组。

注意：设备已经成功 NTP 校时后，即使 MixIO 暂时不可达，已保存的计划仍可继续执行；如果设备重启后完全没有网络，时间尚未校准，计划会等联网校时后再执行。

## 6. 连接 MG90S 舵机

NodeMCU D1/GPIO5 连接舵机信号线。舵机使用独立稳定的 5V 2A 电源，NodeMCU GND 和舵机电源 GND 必须共地。舵机附近并联一个 1000uF 电解电容。

首次动作测试不要安装鱼粮：

1. 先空载通电。
2. 确认舵机回到关闭角度后停止。
3. 如果舵机持续嗡鸣，立即断电并缩小开关角度。
4. ESP8266 在舵机动作时重启，优先检查 5V 电源、电容和共地，不要用软件延时掩盖供电问题。

## 7. 本地预览网页

当前项目可通过本地静态服务器预览。浏览器地址类似：

```text
http://127.0.0.1:4173/
```

本地 HTTP 页面可能因浏览器安全策略无法使用剪贴板或 Web Crypto 的部分能力，最终测试使用 GitHub Pages 提供的 HTTPS 地址。

## 8. 部署到 GitHub Pages

网页没有构建步骤、数据库和环境变量。项目已经包含 `.github/workflows/deploy-pages.yml`，推送到 `main` 分支后会自动发布。

### 8.1 创建仓库并上传

1. 在 GitHub 新建一个仓库，例如 `fish-feeder`。
2. 想零成本使用 GitHub Pages 时，仓库可设为 `Public`；私密 `firmware/esp8266_fish_feeder/config.h` 仍绝不能提交。若使用私有仓库，请确认你的 GitHub 账号计划支持 Pages。
3. 在 PowerShell 中执行：

```powershell
cd C:\Users\Administrator\Desktop\硬件开发\fish-feeder
git init
git branch -M main
git add .
git status
git commit -m "Initial fish feeder page"
git remote add origin https://github.com/你的用户名/fish-feeder.git
git push -u origin main
```

执行 `git status` 时，不能看到以下文件：

- `firmware/esp8266_fish_feeder/config.h`
- 任何包含 MixIO 项目密码或命令签名密钥的私密备份文件

### 8.2 启用 GitHub Pages

1. 打开 GitHub 仓库的 `Settings → Pages`。
2. 在 `Build and deployment` 中选择 `GitHub Actions`。
3. 回到 `Actions` 页面，等待 `Deploy fish feeder page` 工作流完成。
4. 部署地址一般是：

```text
https://你的用户名.github.io/fish-feeder/
```

以后更新网页只需：

```powershell
git add .
git commit -m "Update fish feeder page"
git push
```

## 9. 第一台手机授权

1. 用手机打开 GitHub Pages 的 HTTPS 地址。
2. 点击右上角“手机授权”。
3. 用户名和项目名已经预填。
4. 输入 MixIO 项目密码。
5. 输入与固件 `COMMAND_SECRET` 完全一致的命令签名密钥。
6. 保持“保存在当前浏览器中”选中。
7. 点击“保存并连接”。

这些信息只写入当前域名的浏览器存储，并由手机直接用于连接 MixIO WSS。GitHub Pages 不会收到这些字段。

本地预览地址与 GitHub Pages 地址属于不同网站，浏览器存储不会互通，因此生产地址第一次打开时仍需授权一次。

## 10. 授权其他手机

第一台手机连接成功后：

1. 打开“手机授权”。
2. 点击“复制授权链接”。
3. 通过私聊发送给可信的人。
4. 对方打开链接后，网页自动把配置保存到对方手机。
5. 地址栏中的 `#config=...` 会立即被清除。

授权链接本身等同于项目密码和签名密钥。不要发送到群聊、朋友圈、公开笔记或短链接平台。需要撤销所有旧授权时，同时更换 MixIO 项目密码和命令签名密钥，然后重新烧录并重新授权手机。

## 11. 测试手动投喂

1. 页面顶部 MixIO 显示“已连接”。
2. 投喂器显示“在线”。
3. 点击“请求状态”，检查 Wi-Fi 信号、固件版本和设备时间。
4. 不放鱼粮，选择 1 份并点击“立即投喂”。
5. 页面应依次显示命令发送、设备执行和投喂完成。
6. 一分钟内再次投喂，应被安全间隔拒绝。
7. 完成空载测试后，再安装少量鱼粮测试真实出粮量。

## 12. 设置和验证定时投喂

定时计划保存在 ESP8266，而不是手机：

1. 点击“添加计划”。
2. 时间设置为当前北京时间之后 3～5 分钟。
3. 选择 1 份和当天星期。
4. 保持计划启用，点击“保存到投喂器”。
5. 等待“定时计划已保存到投喂器”的提示。
6. 点击“请求状态”，确认计划仍显示在页面中。
7. 完全关闭网页或关闭手机屏幕。
8. 到达设定时间后观察舵机是否自动执行。
9. 重新打开网页，检查最近投喂时间、来源和 24 小时份量。

注意：

- 固件固定使用北京时间 UTC+8，不跟随手机所在时区。
- 设备上电后必须至少联网完成 NTP 校时，时间未就绪时不会盲目执行计划。
- 同一分钟内有重叠计划时，最短投喂间隔会让后续计划跳过。
- 手动投喂发生在定时计划前一分钟内，计划也可能因安全间隔被跳过。
- 达到 24 小时最大份量后，定时计划不会突破上限。

## 13. 常见故障

| 现象 | 检查内容 |
|---|---|
| 网页一直显示 MixIO 连接中 | 项目密码、手机网络、MixIO WSS 8084 是否可达 |
| MixIO 已连接但设备离线 | 家庭 Wi-Fi、MQTT 1883、ESP8266 串口日志和供电 |
| `invalid_signature` | 手机与固件的命令签名密钥不一致 |
| `clock_not_ready` | 等待 NTP 校时，检查 DNS 和互联网连接 |
| 计划保存失败 | 设备是否在线、固件是否已升级到 1.1.0 |
| 计划到点未执行 | 星期、启用状态、北京时间、安全间隔和 24 小时上限 |
| 页面显示计划被安全间隔跳过 | 前一分钟内发生过手动或其他定时投喂 |
| 舵机动作时 ESP8266 重启 | 5V 电源不足、没有共地或缺少大电容 |
| 显示完成但没有鱼粮 | 量杯卡住、鱼粮受潮架桥；当前版本没有落料传感器 |

## 14. 正式上线前验收

- 连续运行至少 7 天。
- 完成至少 100 次空载动作和 50 次装粮动作。
- 实测单份重量，确认 1～3 份不会过量。
- 测试断电重启、路由器重启、MixIO 临时断线和手机流量访问。
- 检查计划在网页关闭时仍能执行。
- 检查断电发生在舵机动作中时不会在同一天重复执行同一计划。
- 使用防潮外壳、可靠端子和稳定电源后再长期无人值守。
