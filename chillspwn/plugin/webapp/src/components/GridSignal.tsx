import { useEffect, useState, useRef } from "react";

const GRID_SIZE = 40;
const MAX_SIGNALS = 5;
const MULTIPLY_CHANCE = 0.3;
const SPEED = 250;

type Direction = "up" | "down" | "left" | "right";

interface Signal {
  id: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: Direction;
}

export default function GridSignal({ accent }: { accent: string }) {
  const [isMounted, setIsMounted] = useState(false);
  const [signals, setSignals] = useState<Signal[]>([]);
  const signalsRef = useRef<Signal[]>([]);
  const idCounter = useRef(0);

  useEffect(() => {
    setIsMounted(true);

    const startX = Math.floor(window.innerWidth / 2 / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor(window.innerHeight / 2 / GRID_SIZE) * GRID_SIZE;

    signalsRef.current = [
      {
        id: idCounter.current++,
        x: startX,
        y: startY,
        targetX: startX + GRID_SIZE,
        targetY: startY,
        direction: "right",
      },
    ];

    let lastTime = performance.now();
    let animationFrameId: number;

    const tick = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      const currentSignals = [...signalsRef.current];
      const newSignals: Signal[] = [];
      const signalsToKeep: Signal[] = [];
      const occupiedNodes = new Map<string, number>();

      for (let i = 0; i < currentSignals.length; i++) {
        let sig = { ...currentSignals[i] };

        const dx = sig.targetX - sig.x;
        const dy = sig.targetY - sig.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const moveDist = SPEED * dt;

        if (dist <= moveDist) {
          sig.x = sig.targetX;
          sig.y = sig.targetY;

          const dirs: Direction[] = ["up", "down", "left", "right"];
          const opposite: Record<Direction, Direction> = {
            up: "down", down: "up", left: "right", right: "left",
          };

          const validDirs = dirs.filter((d) => d !== opposite[sig.direction]);
          let nextDir = validDirs[Math.floor(Math.random() * validDirs.length)];

          const pad = GRID_SIZE * 2;
          const outX = sig.x < pad || sig.x > window.innerWidth - pad;
          const outY = sig.y < pad || sig.y > window.innerHeight - pad;

          if (outX || outY) {
            nextDir = sig.x > window.innerWidth / 2 ? "left" : "right";
            if (Math.random() > 0.5) {
              nextDir = sig.y > window.innerHeight / 2 ? "up" : "down";
            }
          }

          const isTurning = nextDir !== sig.direction;
          const oldDir = sig.direction;

          if (
            isTurning &&
            Math.random() < MULTIPLY_CHANCE &&
            signalsToKeep.length + newSignals.length < MAX_SIGNALS
          ) {
            newSignals.push({
              id: idCounter.current++,
              x: sig.x,
              y: sig.y,
              direction: oldDir,
              targetX: sig.x + (oldDir === "right" ? GRID_SIZE : oldDir === "left" ? -GRID_SIZE : 0),
              targetY: sig.y + (oldDir === "down" ? GRID_SIZE : oldDir === "up" ? -GRID_SIZE : 0),
            });
          }

          sig.direction = nextDir;
          sig.targetX = sig.x + (nextDir === "right" ? GRID_SIZE : nextDir === "left" ? -GRID_SIZE : 0);
          sig.targetY = sig.y + (nextDir === "down" ? GRID_SIZE : nextDir === "up" ? -GRID_SIZE : 0);
        } else {
          sig.x += (dx / dist) * moveDist;
          sig.y += (dy / dist) * moveDist;
        }

        const nodeKey = `${sig.targetX},${sig.targetY}`;
        if (occupiedNodes.has(nodeKey)) continue;
        occupiedNodes.set(nodeKey, sig.id);
        signalsToKeep.push(sig);
      }

      signalsRef.current = [...signalsToKeep, ...newSignals];

      if (signalsRef.current.length === 0) {
        const sx = Math.floor(window.innerWidth / 2 / GRID_SIZE) * GRID_SIZE;
        const sy = Math.floor(window.innerHeight / 2 / GRID_SIZE) * GRID_SIZE;
        signalsRef.current.push({
          id: idCounter.current++,
          x: sx, y: sy,
          targetX: sx + GRID_SIZE, targetY: sy,
          direction: "right",
        });
      }

      setSignals([...signalsRef.current]);
      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  if (!isMounted) return null;

  return (
    <>
      {signals.map((sig) => {
        const isHorizontal = sig.direction === "left" || sig.direction === "right";
        return (
          <div
            key={sig.id}
            className="absolute top-0 left-0 pointer-events-none rounded-full"
            data-grid-signal
            style={{
              width: isHorizontal ? GRID_SIZE : 3,
              height: isHorizontal ? 3 : GRID_SIZE,
              backgroundColor: accent,
              boxShadow: `0 0 15px ${accent}, 0 0 30px ${accent}`,
              opacity: 1,
              transform: `translate(${sig.x}px, ${sig.y}px)`,
              marginLeft: isHorizontal ? (sig.direction === "left" ? 0 : -GRID_SIZE) : -1,
              marginTop: isHorizontal ? -1 : (sig.direction === "up" ? 0 : -GRID_SIZE),
              transition: "background-color 0.4s ease, box-shadow 0.4s ease",
            }}
          />
        );
      })}
    </>
  );
}
