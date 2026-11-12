export interface GenerationRequest {
  prompt: string;
  model: string;
  executable: string;
  timeout: number;
  signal: AbortSignal;
}

export interface CommitProvider {
  readonly id: string;
  generate(request: GenerationRequest): Promise<string>;
}
