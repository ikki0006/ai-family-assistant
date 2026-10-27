/** A bounded, read-only snapshot of the configured public repository. */
export interface SourceRepository {
	manifest(): Promise<{ revision: string; paths: string[] }>;
	read(revision: string, paths: string[]): Promise<{ path: string; content: string }[]>;
}
