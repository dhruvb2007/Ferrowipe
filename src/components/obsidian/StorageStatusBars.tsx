import React, { useState } from 'react';
import NumberFlow from '@number-flow/react';
import { motion } from 'motion/react';
import { DriveInfo } from '@/types';
import { formatBytes } from '@/utils';
import { cn } from '@/lib/utils';

interface StorageStatusBarsProps {
  drives: DriveInfo[];
  usedPercent: number;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  lowSpaceCount: number;
}

const SEGMENT_COUNT = 36;

export const StorageStatusBars: React.FC<StorageStatusBarsProps> = ({
  drives,
  usedPercent,
  totalBytes,
  usedBytes,
  availableBytes,
  lowSpaceCount,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const filledSegments = Math.round((Math.min(usedPercent, 100) / 100) * SEGMENT_COUNT);

  // Map segments proportionally to drives for interactive hover breakdown
  const segmentDriveInfo = React.useMemo(() => {
    if (totalBytes <= 0 || drives.length === 0) {
      return Array.from({ length: SEGMENT_COUNT }, (_, idx) => ({
        isUsed: idx < filledSegments,
        driveLabel: 'System Storage',
        tone: idx < filledSegments ? 'accent' : 'empty',
      }));
    }

    const result: { isUsed: boolean; driveLabel: string; tone: 'accent' | 'warning' | 'danger' | 'empty' }[] = [];
    let cursor = 0;

    drives.forEach((d) => {
      const segsForDrive = Math.max(1, Math.round((d.used_bytes / totalBytes) * SEGMENT_COUNT));
      const tone: 'accent' | 'warning' | 'danger' =
        d.is_low_space || d.usage_percentage >= 90
          ? 'danger'
          : d.usage_percentage >= 80
          ? 'warning'
          : 'accent';

      for (let i = 0; i < segsForDrive && cursor < SEGMENT_COUNT; i++) {
        result.push({
          isUsed: true,
          driveLabel: `${d.volume_name} (${d.mount_point}) • ${formatBytes(d.used_bytes)} used`,
          tone,
        });
        cursor++;
      }
    });

    while (result.length < SEGMENT_COUNT) {
      result.push({
        isUsed: false,
        driveLabel: `Available Free Headroom • ${formatBytes(availableBytes)}`,
        tone: 'empty',
      });
    }

    return result;
  }, [drives, totalBytes, filledSegments, availableBytes]);

  const activeInfo = hoveredIdx !== null ? segmentDriveInfo[hoveredIdx] : null;

  return (
    <div className="space-y-3">
      {/* Header row with NumberFlow animated percentage */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-2.5">
          <div className="text-3xl font-bold tracking-tight text-[var(--obs-fg)] tabular-nums leading-none flex items-baseline">
            <NumberFlow value={usedPercent} />
            <span className="text-lg font-semibold text-[var(--obs-text-muted)] ml-0.5">%</span>
          </div>
          <span className="text-xs text-[var(--obs-text-muted)]">
            allocated across {drives.length} volume{drives.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="text-right text-[11px] font-mono text-[var(--obs-text-muted)] tabular-nums truncate max-w-[55%]">
          {activeInfo ? (
            <span className="text-[var(--obs-fg)]">{activeInfo.driveLabel}</span>
          ) : (
            <span>
              {formatBytes(usedBytes)} / {formatBytes(totalBytes)}
            </span>
          )}
        </div>
      </div>

      {/* ObsidianUI-style interactive vertical status bars */}
      <div
        className="flex items-center gap-[4px] h-9 w-full"
        onMouseLeave={() => setHoveredIdx(null)}
      >
        {segmentDriveInfo.map((seg, idx) => {
          const isHovered = hoveredIdx === idx;
          const bgStyle =
            seg.tone === 'danger'
              ? 'bg-[var(--obs-danger)]'
              : seg.tone === 'warning'
              ? 'bg-[var(--obs-warning)]'
              : seg.tone === 'accent'
              ? 'bg-[var(--obs-accent)]'
              : 'bg-[var(--obs-muted)]';

          return (
            <motion.div
              key={idx}
              onMouseEnter={() => setHoveredIdx(idx)}
              animate={{
                scaleY: isHovered ? 1.18 : 1,
                opacity: hoveredIdx !== null && !isHovered ? 0.55 : 1,
              }}
              transition={{ type: 'spring', stiffness: 480, damping: 32 }}
              className={cn(
                'flex-1 h-7 rounded-[4px] cursor-pointer transition-colors',
                bgStyle
              )}
            />
          );
        })}
      </div>

      {/* Legend footer */}
      <div className="flex items-center justify-between text-[11px] text-[var(--obs-text-subtle)]">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--obs-accent)]" />
            Allocated
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--obs-muted-hover)]" />
            Free Headroom
          </span>
          {lowSpaceCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[var(--obs-danger)]">
              <span className="h-2 w-2 rounded-full bg-[var(--obs-danger)]" />
              Low Space
            </span>
          )}
        </div>
        <span className="font-mono text-[var(--obs-fg)] font-medium tabular-nums">
          {formatBytes(availableBytes)} free
        </span>
      </div>
    </div>
  );
};
