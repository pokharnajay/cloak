import type { CluiAPI } from '../preload/index'

declare module '*.mp3' {
  const src: string
  export default src
}

declare global {
  interface Window {
    clui: CluiAPI
  }
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<
      React.HTMLAttributes<Electron.WebviewTag> & {
        src?: string
        partition?: string
        allowpopups?: string
      },
      Electron.WebviewTag
    >
  }
}
