@echo off
echo 本工具为了adb 连接盒子  并且重启至U盘启动！
echo 请先用路由器查看N1的IP号   盒子和电脑 请在同一局域网内!
echo QQ群855927068  （N1·Sx05re·LAKKA）
echo made by KIFEN                                                                     
set /p ip=请输入斐讯N1的内网IP地址：
adb kill-server
if "%ip%" == "" echo 提示：请输入正确的IP地址 && goto end
echo 开始通过网络进行ADB连接……
adb connect %ip%
echo *
echo *
echo *
echo 盒子已重启，此窗口可以关闭...
adb shell reboot update


:end
echo 按任意键退出...
pause > nul



