import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Notice = { text: string; error: boolean; retry?: () => void };
const ToastContext = createContext<(id: string, notice: Notice | null) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const insets = useSafeAreaInsets();
  const show = useCallback((id: string, notice: Notice | null) => setNotices(current => {
    const next = { ...current }; delete next[id];
    if (notice) next[id] = notice;
    return next;
  }), []);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', event => setKeyboardHeight(event.endCoordinates.height));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  const notice = Object.values(notices).at(-1);
  return <ToastContext.Provider value={show}>
    <View style={{ flex: 1 }}>{children}
      {notice ? <View pointerEvents={notice.retry ? 'auto' : 'none'} style={{ position: 'absolute', left: 20, right: 20, bottom: Math.max(insets.bottom + 80, keyboardHeight + 16), padding: 16, borderRadius: 14, backgroundColor: notice.error ? '#482631' : '#153D2B', borderWidth: 1, borderColor: notice.error ? '#777da6' : '#59B887' }}>
        <Text accessibilityRole={notice.error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ color: notice.error ? '#fff' : '#C6F6D5', fontSize: 14 }}>{notice.text}</Text>
        {notice.retry ? <Pressable accessibilityRole="button" onPress={notice.retry} style={{ paddingVertical: 12 }}><Text style={{ color: '#c8d2ff', fontWeight: '600' }}>Try again</Text></Pressable> : null}
      </View> : null}
    </View>
  </ToastContext.Provider>;
}

// Screens own their timers. Load errors with retry remain until retry/navigation.
export function useScreenToast(error: string, success: string, retry?: () => void) {
  const show = useContext(ToastContext);
  const id = useId();
  const retryRef = useRef(retry); retryRef.current = retry;
  const canRetry = Boolean(retry);
  useEffect(() => {
    show(id, error || success ? { text: error || success, error: Boolean(error), retry: canRetry ? () => retryRef.current?.() : undefined } : null);
    return () => show(id, null);
  }, [error, success, show, id, canRetry]);
}
