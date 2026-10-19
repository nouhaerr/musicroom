import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Notice = { text: string; error: boolean } | null;
const ToastContext = createContext<(notice: Notice) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice>(null);
  const insets = useSafeAreaInsets();
  return <ToastContext.Provider value={setNotice}>
    <View style={{ flex: 1 }}>{children}
      {notice ? <View pointerEvents="none" style={{ position: 'absolute', left: 20, right: 20, bottom: insets.bottom + 80, padding: 16, borderRadius: 14, backgroundColor: notice.error ? '#482631' : '#242d50', borderWidth: 1, borderColor: '#777da6' }}>
        <Text accessibilityRole={notice.error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ color: '#fff', fontSize: 14 }}>{notice.text}</Text>
      </View> : null}
    </View>
  </ToastContext.Provider>;
}

// The screen owns the seven-second timer; the host stays outside its ScrollView.
export function useScreenToast(error: string, success: string) {
  const show = useContext(ToastContext);
  useEffect(() => {
    show(error || success ? { text: error || success, error: Boolean(error) } : null);
    return () => show(null);
  }, [error, success, show]);
}
