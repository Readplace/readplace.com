export interface ParsedComponent {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export type SupportedMediaType = 'text/html' | 'text/markdown';

export type Component = {
  to: (mediaType: SupportedMediaType) => ParsedComponent;
};
