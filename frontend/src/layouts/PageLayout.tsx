import type { ReactNode } from 'react';

interface Props {
    children: ReactNode;
    className?: string;
}

export function PageLayout({ children, className = '' }: Props) {
    return (
        <main className={`page-shell ${className}`.trim()}>{children}</main>
    );
}
