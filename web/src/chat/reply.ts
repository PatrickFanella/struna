import remarkGfm from "remark-gfm";

/**
 * How a coach reply is rendered. Pictures are left out, as in a text material: the coach reads pages
 * and files other people wrote, and an image address in its reply would make the browser send a
 * request (and whatever the address carries) the moment the reply is shown.
 */
export const REPLY_MARKDOWN = { remarkPlugins: [remarkGfm], disallowedElements: ["img"] };
