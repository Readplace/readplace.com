export type TimeLeft = {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
};

export function decomposeTimeLeft(ms: number): TimeLeft {
	if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
	const totalSeconds = Math.floor(ms / 1000);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const totalHours = Math.floor(totalMinutes / 60);
	const hours = totalHours % 24;
	const days = Math.floor(totalHours / 24);
	return { days, hours, minutes, seconds };
}
