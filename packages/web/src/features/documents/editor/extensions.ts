import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import { SuggestionMark } from "./SuggestionMark.js";

// Базовый набор расширений редактора — используется и редактором, и при
// рендере контента в HTML (печать, режим игры), чтобы разметка совпадала.
export const baseExtensions = [
  StarterKit,
  Underline,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Link.configure({ openOnClick: false, autolink: false }),
  SuggestionMark,
];
