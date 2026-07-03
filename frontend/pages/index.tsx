import dynamic from 'next/dynamic';

const ComposerApp = dynamic(
    () => import('../src/App').then((mod) => mod.App),
    { ssr: false },
);

export default function IndexPage() {
    return <ComposerApp />;
}
