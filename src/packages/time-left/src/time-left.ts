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

export function formatCounter(timeLeft: TimeLeft): string {
	const parts: string[] = [];
	if (timeLeft.days > 0) parts.push(`${timeLeft.days}d`);
	if (timeLeft.days > 0 || timeLeft.hours > 0) parts.push(`${timeLeft.hours}h`);
	if (timeLeft.days > 0 || timeLeft.hours > 0 || timeLeft.minutes > 0) parts.push(`${timeLeft.minutes}m`);
	parts.push(`${timeLeft.seconds}s`);
	return parts.join(" ");
}
