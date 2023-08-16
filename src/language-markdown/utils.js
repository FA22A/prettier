import assert from "node:assert";
import { locStart, locEnd } from "./loc.js";
import {
  cjkPattern,
  kRegex,
  punctuationPattern,
} from "./constants.evaluate.js";

const INLINE_NODE_TYPES = new Set([
  "liquidNode",
  "inlineCode",
  "emphasis",
  "esComment",
  "strong",
  "delete",
  "wikiLink",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "footnote",
  "footnoteReference",
  "sentence",
  "whitespace",
  "word",
  "break",
  "inlineMath",
]);

const INLINE_NODE_WRAPPER_TYPES = new Set([
  ...INLINE_NODE_TYPES,
  "tableCell",
  "paragraph",
  "heading",
]);

const punctuationRegex = new RegExp(punctuationPattern);

const KIND_NON_CJK = "non-cjk";
const KIND_CJ_LETTER = "cj-letter";
const KIND_K_LETTER = "k-letter";
const KIND_CJK_PUNCTUATION = "cjk-punctuation";

/**
 * @typedef {" " | "\n" | ""} WhitespaceValue
 * @typedef { KIND_NON_CJK | KIND_CJ_LETTER | KIND_K_LETTER | KIND_CJK_PUNCTUATION } WordKind
 * @typedef {{
 *   type: "whitespace",
 *   value: WhitespaceValue,
 *   kind?: never
 * }} WhitespaceNode
 * @typedef {{
 *   type: "word",
 *   value: string,
 *   kind: WordKind,
 *   hasLeadingPunctuation: boolean,
 *   hasTrailingPunctuation: boolean,
 * }} WordNode
 * Node for a single CJK character or a sequence of non-CJK characters
 * @typedef {WhitespaceNode | WordNode} TextNode
 */

/**
 * split text into whitespaces and words
 * @param {string} text
 */
function splitText(text) {
  /** @type {Array<TextNode>} */
  const nodes = [];

  const tokens = text.split(/([\t\n ]+)/);
  for (const [index, token] of tokens.entries()) {
    // whitespace
    if (index % 2 === 1) {
      nodes.push({
        type: "whitespace",
        value: /\n/.test(token) ? "\n" : " ",
      });
      continue;
    }

    // word separated by whitespace

    if ((index === 0 || index === tokens.length - 1) && token === "") {
      continue;
    }

    const innerTokens = token.split(new RegExp(`(${cjkPattern})`));
    for (const [innerIndex, innerToken] of innerTokens.entries()) {
      if (
        (innerIndex === 0 || innerIndex === innerTokens.length - 1) &&
        innerToken === ""
      ) {
        continue;
      }

      // non-CJK word
      if (innerIndex % 2 === 0) {
        if (innerToken !== "") {
          appendNode({
            type: "word",
            value: innerToken,
            kind: KIND_NON_CJK,
            hasLeadingPunctuation: punctuationRegex.test(innerToken[0]),
            hasTrailingPunctuation: punctuationRegex.test(innerToken.at(-1)),
          });
        }
        continue;
      }

      // CJK character
      appendNode(
        punctuationRegex.test(innerToken)
          ? {
              type: "word",
              value: innerToken,
              kind: KIND_CJK_PUNCTUATION,
              hasLeadingPunctuation: true,
              hasTrailingPunctuation: true,
            }
          : {
              type: "word",
              value: innerToken,
              // Korean uses space to divide words, but Chinese & Japanese do not
              kind: kRegex.test(innerToken) ? KIND_K_LETTER : KIND_CJ_LETTER,
              hasLeadingPunctuation: false,
              hasTrailingPunctuation: false,
            },
      );
    }
  }

  // Check for `canBeConvertedToSpace` in ./print-whitespace.js etc.
  if (process.env.NODE_ENV !== "production") {
    for (let i = 1; i < nodes.length; i++) {
      assert(
        !(nodes[i - 1].type === "whitespace" && nodes[i].type === "whitespace"),
        "splitText should not create consecutive whitespace nodes",
      );
    }
  }

  return nodes;

  function appendNode(node) {
    const lastNode = nodes.at(-1);
    if (
      lastNode?.type === "word" &&
      !isBetween(KIND_NON_CJK, KIND_CJK_PUNCTUATION) &&
      // disallow leading/trailing full-width whitespace
      ![lastNode.value, node.value].some((value) => /\u3000/.test(value))
    ) {
      nodes.push({ type: "whitespace", value: "" });
    }
    nodes.push(node);

    function isBetween(kind1, kind2) {
      return (
        (lastNode.kind === kind1 && node.kind === kind2) ||
        (lastNode.kind === kind2 && node.kind === kind1)
      );
    }
  }
}

function getOrderedListItemInfo(orderListItem, originalText) {
  const [, numberText, marker, leadingSpaces] = originalText
    .slice(
      orderListItem.position.start.offset,
      orderListItem.position.end.offset,
    )
    .match(/^\s*(\d+)(\.|\))(\s*)/);

  return { numberText, marker, leadingSpaces };
}

function hasGitDiffFriendlyOrderedList(node, options) {
  if (!node.ordered) {
    return false;
  }

  if (node.children.length < 2) {
    return false;
  }

  const firstNumber = Number(
    getOrderedListItemInfo(node.children[0], options.originalText).numberText,
  );

  const secondNumber = Number(
    getOrderedListItemInfo(node.children[1], options.originalText).numberText,
  );

  if (firstNumber === 0 && node.children.length > 2) {
    const thirdNumber = Number(
      getOrderedListItemInfo(node.children[2], options.originalText).numberText,
    );

    return secondNumber === 1 && thirdNumber === 1;
  }

  return secondNumber === 1;
}

function mapAst(ast, handler) {
  return (function preorder(node, index, parentStack) {
    const newNode = { ...handler(node, index, parentStack) };
    if (newNode.children) {
      newNode.children = newNode.children.map((child, index) =>
        preorder(child, index, [newNode, ...parentStack]),
      );
    }

    return newNode;
  })(ast, null, []);
}

function isAutolink(node) {
  if (node?.type !== "link" || node.children.length !== 1) {
    return false;
  }
  const [child] = node.children;
  return locStart(node) === locStart(child) && locEnd(node) === locEnd(child);
}

export {
  mapAst,
  splitText,
  punctuationPattern,
  getOrderedListItemInfo,
  hasGitDiffFriendlyOrderedList,
  INLINE_NODE_TYPES,
  INLINE_NODE_WRAPPER_TYPES,
  isAutolink,
  KIND_NON_CJK,
  KIND_CJ_LETTER,
  KIND_K_LETTER,
  KIND_CJK_PUNCTUATION,
};
