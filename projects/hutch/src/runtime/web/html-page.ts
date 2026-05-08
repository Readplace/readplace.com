import type { Component, ParsedComponent } from "./component.types";

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

export function HtmlPage(body: string, statusCode: number = 200): Component {
  return {
    to: (mediaType): ParsedComponent => {
      if (mediaType !== 'text/html') {
        return { statusCode: 406, headers: {}, body: '' };
      }
      return {
        statusCode,
        headers: { "content-type": HTML_CONTENT_TYPE },
        body,
      };
    },
  };
}
