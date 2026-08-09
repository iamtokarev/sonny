import { useEffect, useState } from "react";

const spinnerIntervalMs = 120;
const elapsedIntervalMs = 1000;

/** Only one thing on screen animates: the row that is actually running. */
export function useSpinner(active: boolean, frames: readonly string[]): string {
	const [index, setIndex] = useState(0);

	useEffect(() => {
		if (!active) {
			setIndex(0);
			return;
		}

		const timer = setInterval(() => {
			setIndex((current) => (current + 1) % frames.length);
		}, spinnerIntervalMs);

		return () => clearInterval(timer);
	}, [active, frames.length]);

	return frames[index % frames.length] ?? frames[0] ?? "";
}

export function useElapsedSeconds(startedAt: number | null): number {
	const [seconds, setSeconds] = useState(0);

	useEffect(() => {
		if (startedAt === null) {
			setSeconds(0);
			return;
		}

		setSeconds(Math.floor((Date.now() - startedAt) / 1000));

		const timer = setInterval(() => {
			setSeconds(Math.floor((Date.now() - startedAt) / 1000));
		}, elapsedIntervalMs);

		return () => clearInterval(timer);
	}, [startedAt]);

	return seconds;
}

export function formatElapsed(totalSeconds: number): string {
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}

	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);

	if (totalMinutes < 60) {
		return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
	}

	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);

	return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}
