; DaVinci: additions to electron-builder's assisted NSIS installer.
;
; Web server mode serves DaVinci to browsers on the network. A page after the folder choice offers it (silent
; installs: /WEBSERVER, and /PORT=n for another port). When it is on, the installer
;   - starts `DaVinci.exe --serve --host 0.0.0.0 --port n` at sign-in (HKCU Run key) and right away, with a tray
;     icon to open or stop it,
;   - opens the port in Windows Firewall for DaVinci.exe on private networks only (asking for administrator rights
;     when the install itself has none),
;   - shows the address on the last page.
; The uninstaller removes the Run entry, the firewall rule, the remembered port and the .davinci file type. An
; update keeps the choice.
;
; This file is included before MUI2 and UAC.nsh, so everything that needs them sits in macros that
; electron-builder inserts later (customPageAfterChangeDir, customInstall, customUnInstall).

!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

!define DAVINCI_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define DAVINCI_RUN_VALUE "DaVinci web server"
!define DAVINCI_SETTINGS_KEY "Software\DaVinci"
!define DAVINCI_RULE "DaVinci web server"
!define DAVINCI_DEFAULT_PORT 8791

!ifndef BUILD_UNINSTALLER

Var davinciServer
Var davinciPort
Var davinciServerBox
Var davinciPortBox
Var davinciFirewall
Var davinciAddress
Var davinciFinishText

!define MUI_FINISHPAGE_TEXT_LARGE
!define MUI_FINISHPAGE_TEXT "$davinciFinishText"

!macro customInit
  StrCpy $davinciFinishText "$(^NameDA) has been installed on your computer.$\r$\n$\r$\nClick Finish to close Setup."
  ; the last install's choice (an update or a reinstall keeps it)
  StrCpy $davinciServer ${BST_UNCHECKED}
  StrCpy $davinciPort ${DAVINCI_DEFAULT_PORT}
  ReadRegStr $0 HKCU "${DAVINCI_RUN_KEY}" "${DAVINCI_RUN_VALUE}"
  ${If} $0 != ""
    StrCpy $davinciServer ${BST_CHECKED}
  ${EndIf}
  ReadRegStr $0 HKCU "${DAVINCI_SETTINGS_KEY}" "ServerPort"
  ${If} $0 != ""
    StrCpy $davinciPort $0
  ${EndIf}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/WEBSERVER" $R1
  ${IfNot} ${Errors}
    StrCpy $davinciServer ${BST_CHECKED}
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/PORT=" $R1
  ${IfNot} ${Errors}
    StrCpy $davinciPort $R1
  ${EndIf}
  Call davinciCheckPort
!macroend

!macro customPageAfterChangeDir
  Page custom davinciServerPage davinciServerPageLeave

  ; $davinciPort as a whole number in 1024..65535, else the default
  Function davinciCheckPort
    IntOp $0 $davinciPort + 0
    ${If} "$0" != "$davinciPort"
    ${OrIf} $0 < 1024
    ${OrIf} $0 > 65535
      StrCpy $davinciPort ${DAVINCI_DEFAULT_PORT}
    ${EndIf}
  FunctionEnd

  Function davinciServerPage
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Web server mode" "Use DaVinci from other computers, tablets and phones."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 0 100% 12u "Web server mode — serve DaVinci to browsers on your network"
    Pop $davinciServerBox
    ${NSD_SetState} $davinciServerBox $davinciServer
    ${NSD_CreateLabel} 12u 18u 280u 44u "When this is on, DaVinci runs in the background whenever you sign in to Windows, with a tray icon to open or stop it. Windows Firewall lets other computers on private networks (home, work) reach it; public networks stay closed."
    Pop $0
    ${NSD_CreateLabel} 12u 70u 30u 12u "Port:"
    Pop $0
    ${NSD_CreateNumber} 44u 68u 44u 12u "$davinciPort"
    Pop $davinciPortBox
    ${NSD_CreateLabel} 96u 70u 190u 12u "(${DAVINCI_DEFAULT_PORT} unless something else uses it)"
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function davinciServerPageLeave
    ${NSD_GetState} $davinciServerBox $davinciServer
    ${NSD_GetText} $davinciPortBox $0
    IntOp $1 $0 + 0
    ${If} $davinciServer == ${BST_CHECKED}
      ${If} "$1" != "$0"
      ${OrIf} $1 < 1024
      ${OrIf} $1 > 65535
        MessageBox MB_ICONEXCLAMATION|MB_OK "Choose a port from 1024 to 65535."
        Abort
      ${EndIf}
    ${EndIf}
    StrCpy $davinciPort $0
    Call davinciCheckPort
  FunctionEnd

  ; netsh with the arguments in $0: directly when the installer is elevated, else through a UAC prompt
  Function davinciNetsh
    ${If} ${UAC_IsAdmin}
      nsExec::Exec '"$SYSDIR\netsh.exe" $0'
      Pop $1
    ${Else}
      ExecShellWait "runas" "$SYSDIR\netsh.exe" "$0" SW_HIDE
    ${EndIf}
  FunctionEnd

  ; $davinciFirewall = 1 when the firewall has DaVinci's rule
  Function davinciFindRule
    nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall show rule name="${DAVINCI_RULE}"'
    Pop $0
    ${If} $0 == 0
      StrCpy $davinciFirewall 1
    ${Else}
      StrCpy $davinciFirewall 0
    ${EndIf}
  FunctionEnd

  ; $davinciAddress = this computer's address on its network (the adapter with a default gateway), else its name
  Function davinciFindAddress
    ReadEnvStr $davinciAddress COMPUTERNAME
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "((Get-NetIPConfiguration | Where-Object { $$_.IPv4DefaultGateway -and $$_.NetAdapter.Status -eq $\'Up$\' } | Select-Object -First 1).IPv4Address | Select-Object -First 1).IPAddress"'
    Pop $0
    Pop $1
    ${If} $0 == 0
      ; drop the trailing line break
      ${Do}
        StrCpy $2 $1 1 -1
        ${If} $2 == "$\r"
        ${OrIf} $2 == "$\n"
        ${OrIf} $2 == " "
          StrCpy $1 $1 -1
        ${Else}
          ${ExitDo}
        ${EndIf}
      ${Loop}
      ${If} $1 != ""
        StrCpy $davinciAddress $1
      ${EndIf}
    ${EndIf}
  FunctionEnd
!macroend

!macro customInstall
  ${If} $davinciServer == ${BST_CHECKED}
    WriteRegStr HKCU "${DAVINCI_RUN_KEY}" "${DAVINCI_RUN_VALUE}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --serve --host 0.0.0.0 --port $davinciPort'
    WriteRegStr HKCU "${DAVINCI_SETTINGS_KEY}" "ServerPort" "$davinciPort"
    ; one rule, for this port and program: replace any earlier one
    Call davinciFindRule
    ${If} $davinciFirewall == 1
      StrCpy $0 'advfirewall firewall delete rule name="${DAVINCI_RULE}"'
      Call davinciNetsh
    ${EndIf}
    StrCpy $0 'advfirewall firewall add rule name="${DAVINCI_RULE}" dir=in action=allow protocol=TCP localport=$davinciPort profile=private program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes'
    Call davinciNetsh
    Call davinciFindRule
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" "--serve --host 0.0.0.0 --port $davinciPort"
    Call davinciFindAddress
    DetailPrint "Web server: http://$davinciAddress:$davinciPort/"
    StrCpy $davinciFinishText "$(^NameDA) has been installed, and its web server is running.$\r$\n$\r$\nOpen it from any browser on your network:$\r$\n      http://$davinciAddress:$davinciPort/$\r$\n$\r$\nOn this computer: http://127.0.0.1:$davinciPort/"
    ${If} $davinciFirewall != 1
      StrCpy $davinciFinishText "$davinciFinishText$\r$\n$\r$\nWindows Firewall was not opened, so other computers cannot connect yet. Run Setup again to allow it."
    ${EndIf}
  ${Else}
    DeleteRegValue HKCU "${DAVINCI_RUN_KEY}" "${DAVINCI_RUN_VALUE}"
    DeleteRegKey HKCU "${DAVINCI_SETTINGS_KEY}"
    Call davinciFindRule
    ${If} $davinciFirewall == 1
      StrCpy $0 'advfirewall firewall delete rule name="${DAVINCI_RULE}"'
      Call davinciNetsh
    ${EndIf}
  ${EndIf}
!macroend

!else

; An uninstall that is part of an update or a reinstall (electron-builder passes --updated) leaves the server and
; the file type alone: the new installer decides.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    ; .davinci itself (electron-builder removes only the "DaVinci project" class it points to)
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.davinci\OpenWithProgids" "DaVinci project"
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.davinci\OpenWithProgids"
    ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.davinci" ""
    ${If} $0 == "DaVinci project"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.davinci" ""
    ${EndIf}
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.davinci"
    DeleteRegValue HKCU "${DAVINCI_RUN_KEY}" "${DAVINCI_RUN_VALUE}"
    DeleteRegKey HKCU "${DAVINCI_SETTINGS_KEY}"
    nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall show rule name="${DAVINCI_RULE}"'
    Pop $0
    ${If} $0 == 0
      ${If} ${UAC_IsAdmin}
        nsExec::Exec '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="${DAVINCI_RULE}"'
        Pop $0
      ${Else}
        ExecShellWait "runas" "$SYSDIR\netsh.exe" 'advfirewall firewall delete rule name="${DAVINCI_RULE}"' SW_HIDE
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!endif
