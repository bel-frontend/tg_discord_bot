import type { AppProps } from 'next/app';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
import '../src/styles.css';

export default function NextApp({ Component, pageProps }: AppProps) {
    return <Component {...pageProps} />;
}
