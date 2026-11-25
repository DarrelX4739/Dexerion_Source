; Dexerion installer copy — pulled in by electron-builder's `include` hook.
; Every visible string is Dexerion-owned: no version number, no feature list.
; MUI_* defines must exist before the pages are inserted, which is exactly
; where customHeader runs; customWelcomePage then adds the welcome page
; (electron-builder does not include one by default).

!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Welcome"
  !define MUI_WELCOMEPAGE_TEXT "This wizard will install Dexerion on this Windows account. No administrator rights are needed, and your existing profile data is kept.$\r$\n$\r$\nClick Next to continue."
  !define MUI_DIRECTORYPAGE_TEXT_TOP "Dexerion will be installed in the folder below. Keep the default, or choose another folder."
  !define MUI_FINISHPAGE_TITLE "Dexerion is ready"
  !define MUI_FINISHPAGE_TEXT "Dexerion has been installed on this computer.$\r$\n$\r$\nClick Finish to close Setup."
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Dexerion"
  !define MUI_BUTTONTEXT_NEXT "Next"
  !define MUI_BUTTONTEXT_INSTALL "Install Dexerion"
  !define MUI_BUTTONTEXT_FINISH "Finish"
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
