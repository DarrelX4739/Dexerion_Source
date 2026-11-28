; Dexerion installer copy — pulled in by electron-builder's `include` hook.
; Every visible string is Dexerion-owned: no version number, no feature list.
; MUI_* defines must exist before the pages are inserted, which is exactly
; where customHeader runs; customWelcomePage then adds the welcome page
; (electron-builder does not include one by default).

!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Dexerion"
  !define MUI_WELCOMEPAGE_TEXT "Set up Dexerion for this Windows account. Setup does not need administrator rights and keeps your existing Dexerion profile.$\r$\n$\r$\nClick Next to continue."
  !define MUI_DIRECTORYPAGE_TEXT_TOP "Choose where to install Dexerion. Keep the folder below or browse to a different location."
  !define MUI_FINISHPAGE_TITLE "Dexerion is ready"
  !define MUI_FINISHPAGE_TEXT "Installation is complete. You can launch Dexerion now or open it later from the Start menu.$\r$\n$\r$\nClick Finish to close Setup."
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Dexerion"
  !define MUI_BUTTONTEXT_NEXT "Next"
  !define MUI_BUTTONTEXT_INSTALL "Install Dexerion"
  !define MUI_BUTTONTEXT_FINISH "Finish"
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
