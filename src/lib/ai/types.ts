export interface AiRequest {
  task: string;
  systemInstruction: string;
  input: unknown;
  schema: Record<string, unknown>;
}
export interface AiProviderResult<T> {
  output: T;
  inputTokens?: number;
  outputTokens?: number;
}
export interface AiProvider {
  generateStructured<T>(request: AiRequest): Promise<AiProviderResult<T>>;
}
export interface AiRunInput {
  registrationId: string;
  feature: string;
  field: string;
  mode: string;
  inputCharacterCount: number;
}
