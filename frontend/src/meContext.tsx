import { createContext, useContext, type ReactNode } from 'react';
import type { Me } from '../../shared/types';

const MeCtx = createContext<Me | null>(null);

export function useMe(): Me | null {
    return useContext(MeCtx);
}

export function MeProvider({
    me,
    children,
}: {
    me: Me | null;
    children: ReactNode;
}) {
    return <MeCtx.Provider value={me}>{children}</MeCtx.Provider>;
}
