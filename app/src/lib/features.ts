// Switches for whole features, kept in one place.
//
// PLATFORM_VIEW: the station board (app/platform.tsx). Off since 26 Oct: the owner asked for it to stay hidden
// until its stop lists are reliable. While false, nothing opens it: no icon on the stop screen, no item in the hold
// menu, openPlatform() does nothing, and a link straight to /platform goes to Home. The code stays in the repo;
// turning it back on is this one line (true) and an over the air update.
export const PLATFORM_VIEW = false;
