// Live board pushes for the stop screen and the full screen board (boardPushCore.ts has the rules). A socket is open
// only while the screen is on view, the app is in front and remote config has livePush on (off by default); it closes
// when the app goes to the background or the screen is left. If it fails it is tried 3 times, then the screen keeps
// its normal polling.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { appActive } from './activity';
import { useConfig } from './config';
import { apiBase } from './server';
import { applyPush, pushFlagOn, pushUrl, retryDelay } from './boardPushCore';

/** Opens the board's socket while wanted; onBoard gets each new board. `live` is true while the socket is open. */
export function useBoardPush(stop: string | null, mode: string | null, onBoard: (board: any) => void): { live: boolean } {
  const cfg = useConfig();
  const flag = pushFlagOn(cfg);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(appActive());
  const [live, setLive] = useState(false);
  const cb = useRef(onBoard);
  cb.current = onBoard;
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(appActive(s)));
    return () => sub.remove();
  }, []);
  const want = flag && focused && active && !!stop;
  useEffect(() => {
    if (!want || !stop) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    let done = false;
    let cur: any = null;
    const open = () => {
      if (done) return;
      try { ws = new WebSocket(pushUrl(apiBase(), stop, mode)); } catch { return retry(); }
      ws.onopen = () => { tries = 0; setLive(true); };
      ws.onmessage = (e) => {
        let msg: any = null;
        try { msg = JSON.parse(String(e.data)); } catch { return; }
        const r = applyPush(cur, msg);
        if (r.needFull) { try { ws?.send('full'); } catch {} return; }
        if (r.board) { cur = r.board; cb.current(r.board); }
      };
      ws.onerror = () => {};
      ws.onclose = () => { setLive(false); ws = null; retry(); };
    };
    const retry = () => {
      if (done) return;
      const wait = retryDelay(tries++);
      if (wait == null) return;
      timer = setTimeout(open, wait);
    };
    open();
    return () => {
      done = true;
      if (timer) clearTimeout(timer);
      setLive(false);
      try { ws?.close(1000, 'left'); } catch {}
    };
  }, [want, stop, mode]);
  return { live: want && live };
}
