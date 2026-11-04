/**
 * The extension's own UI text, in the game's eleven languages.
 *
 * Where the game already says the same thing (Copied to clipboard, Commander,
 * Cards, Close, Open), the text is the game's, copied from
 * Assets/Resources/Localization/<code>.json, so a viewer reads the words the
 * streamer sees. The rest is the extension's own and lives only here.
 *
 * Card names are not here: they come from the card host with the card data.
 */
import type { Locale } from "../../shared/locale.ts";

export interface Strings {
  viewDeck: string;
  copyLink: string;
  copy: string;
  copied: string;
  copyFailed: string;
  openSite: string;
  cards: string;
  commander: string;
  close: string;
  deckCode: string;
  waiting: string;
  hidden: string;
}

const STRINGS: Record<Locale, Strings> = {
  en: {
    viewDeck: "View Deck",
    copyLink: "Copy deck link",
    copy: "Copy",
    copied: "Copied to clipboard",
    copyFailed: "Press and hold the link to copy it",
    openSite: "Open on the website",
    cards: "Cards",
    commander: "Commander",
    close: "Close",
    deckCode: "Deck code",
    waiting: "The deck appears here when the streamer starts a match.",
    hidden: "The streamer has hidden their deck.",
  },
  de: {
    viewDeck: "Deck ansehen",
    copyLink: "Deck-Link kopieren",
    copy: "Kopieren",
    copied: "In die Zwischenablage kopiert",
    copyFailed: "Halte den Link gedrückt, um ihn zu kopieren",
    openSite: "Auf der Website öffnen",
    cards: "Karten",
    commander: "Kommandant",
    close: "Schließen",
    deckCode: "Deck-Code",
    waiting: "Das Deck erscheint hier, sobald der Streamer ein Match beginnt.",
    hidden: "Der Streamer hat sein Deck ausgeblendet.",
  },
  "es-419": {
    viewDeck: "Ver mazo",
    copyLink: "Copiar enlace del mazo",
    copy: "Copiar",
    copied: "Copiado al portapapeles",
    copyFailed: "Mantén presionado el enlace para copiarlo",
    openSite: "Abrir en el sitio web",
    cards: "Cartas",
    commander: "Comandante",
    close: "Cerrar",
    deckCode: "Código del mazo",
    waiting: "El mazo aparecerá aquí cuando el streamer empiece una partida.",
    hidden: "El streamer ocultó su mazo.",
  },
  fr: {
    viewDeck: "Voir le deck",
    copyLink: "Copier le lien du deck",
    copy: "Copier",
    copied: "Copié dans le presse-papiers",
    copyFailed: "Appuyez longuement sur le lien pour le copier",
    openSite: "Ouvrir sur le site",
    cards: "Cartes",
    commander: "Commandant",
    close: "Fermer",
    deckCode: "Code du deck",
    waiting: "Le deck apparaîtra ici quand le streamer lancera une partie.",
    hidden: "Le streamer a masqué son deck.",
  },
  it: {
    viewDeck: "Vedi mazzo",
    copyLink: "Copia link del mazzo",
    copy: "Copia",
    copied: "Copiato negli appunti",
    copyFailed: "Tieni premuto il link per copiarlo",
    openSite: "Apri sul sito",
    cards: "Carte",
    commander: "Comandante",
    close: "Chiudi",
    deckCode: "Codice del mazzo",
    waiting: "Il mazzo apparirà qui quando lo streamer inizierà una partita.",
    hidden: "Lo streamer ha nascosto il suo mazzo.",
  },
  ja: {
    viewDeck: "デッキを見る",
    copyLink: "デッキのリンクをコピー",
    copy: "コピー",
    copied: "クリップボードにコピーしました",
    copyFailed: "リンクを長押ししてコピーしてください",
    openSite: "ウェブサイトで開く",
    cards: "カード",
    commander: "指揮官",
    close: "閉じる",
    deckCode: "デッキコード",
    waiting: "配信者が対戦を始めると、ここにデッキが表示されます。",
    hidden: "配信者はデッキを非表示にしています。",
  },
  ko: {
    viewDeck: "덱 보기",
    copyLink: "덱 링크 복사",
    copy: "복사",
    copied: "클립보드에 복사했습니다",
    copyFailed: "링크를 길게 눌러 복사하세요",
    openSite: "웹사이트에서 열기",
    cards: "카드",
    commander: "사령관",
    close: "닫기",
    deckCode: "덱 코드",
    waiting: "스트리머가 대전을 시작하면 여기에 덱이 표시됩니다.",
    hidden: "스트리머가 덱을 숨겼습니다.",
  },
  pl: {
    viewDeck: "Zobacz talię",
    copyLink: "Kopiuj link do talii",
    copy: "Kopiuj",
    copied: "Skopiowano do schowka",
    copyFailed: "Przytrzymaj link, aby go skopiować",
    openSite: "Otwórz na stronie",
    cards: "Karty",
    commander: "Dowódca",
    close: "Zamknij",
    deckCode: "Kod talii",
    waiting: "Talia pojawi się tutaj, gdy streamer rozpocznie mecz.",
    hidden: "Streamer ukrył swoją talię.",
  },
  "pt-BR": {
    viewDeck: "Ver baralho",
    copyLink: "Copiar link do baralho",
    copy: "Copiar",
    copied: "Copiado para a área de transferência",
    copyFailed: "Toque e segure o link para copiá-lo",
    openSite: "Abrir no site",
    cards: "Cartas",
    commander: "Comandante",
    close: "Fechar",
    deckCode: "Código do baralho",
    waiting: "O baralho aparece aqui quando o streamer começar uma partida.",
    hidden: "O streamer ocultou o baralho.",
  },
  ru: {
    viewDeck: "Открыть колоду",
    copyLink: "Копировать ссылку на колоду",
    copy: "Копировать",
    copied: "Скопировано в буфер обмена",
    copyFailed: "Нажмите и удерживайте ссылку, чтобы скопировать",
    openSite: "Открыть на сайте",
    cards: "Карты",
    commander: "Командир",
    close: "Закрыть",
    deckCode: "Код колоды",
    waiting: "Колода появится здесь, когда стример начнёт матч.",
    hidden: "Стример скрыл свою колоду.",
  },
  "zh-CN": {
    viewDeck: "查看卡组",
    copyLink: "复制卡组链接",
    copy: "复制",
    copied: "已复制到剪贴板",
    copyFailed: "长按链接即可复制",
    openSite: "在网站上打开",
    cards: "卡牌",
    commander: "指挥官",
    close: "关闭",
    deckCode: "卡组代码",
    waiting: "主播开始对局后，卡组会显示在这里。",
    hidden: "主播隐藏了卡组。",
  },
};

export function stringsFor(locale: Locale): Strings {
  return STRINGS[locale] ?? STRINGS.en;
}
