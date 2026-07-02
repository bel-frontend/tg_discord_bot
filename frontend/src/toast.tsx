import {
    createContext,
    useCallback,
    useContext,
    useState,
    type ReactNode,
} from 'react';
export type ToastKind = 'info' | 'success' | 'warn' | 'error';

interface ToastItem {
    id: number;
    message: string;
    kind: ToastKind;
}

const ToastCtx = createContext<(message: string, kind?: ToastKind) => void>(
    () => {},
);

export function useToast() {
    return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<ToastItem[]>([]);

    const push = useCallback((message: string, kind: ToastKind = 'info') => {
        const id = Date.now() + Math.random();
        setItems((cur) => [...cur, { id, message, kind }]);
        setTimeout(() => {
            setItems((cur) => cur.filter((t) => t.id !== id));
        }, 3500);
    }, []);

    return (
        <ToastCtx.Provider value={push}>
            {children}
            <div className="toasts">
                {items.map((t) => (
                    <div key={t.id} className={`toast ${t.kind}`}>
                        {t.message}
                    </div>
                ))}
            </div>
        </ToastCtx.Provider>
    );
}
