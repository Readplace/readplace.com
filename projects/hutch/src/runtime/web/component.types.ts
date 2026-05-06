export interface ParsedComponent {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export type SupportedMediaType = 'text/html' | 'application/vnd.siren+json';

export type Component = {
  to: (mediaType: SupportedMediaType) => ParsedComponent;
};
