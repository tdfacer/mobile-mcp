import {
	TestSession, TestAction, TestScript, TestScriptStep,
	TestReport, ReportError,
} from "./schemas";

export interface TestStore {
	// Sessions
	createSession(session: TestSession): void;
	getSession(id: string): TestSession | undefined;
	updateSession(id: string, patch: Partial<TestSession>): void;
	listSessions(limit?: number): TestSession[];

	// Actions
	createAction(action: TestAction): void;
	getActionsForSession(sessionId: string): TestAction[];

	// Scripts
	createScript(script: TestScript): void;
	getScript(id: string): TestScript | undefined;
	updateScript(id: string, patch: Partial<TestScript>): void;
	listScripts(): TestScript[];
	deleteScript(id: string): void;

	// Script steps
	createStep(step: TestScriptStep): void;
	getStepsForScript(scriptId: string): TestScriptStep[];
	deleteStepsForScript(scriptId: string): void;

	// Reports
	createReport(report: TestReport): void;
	getReport(id: string): TestReport | undefined;
	updateReport(id: string, patch: Partial<TestReport>): void;
	listReports(limit?: number): TestReport[];

	// Report errors
	addReportError(reportId: string, error: ReportError): void;
	getReportErrors(reportId: string): ReportError[];

	// Lifecycle
	close(): void;
}
