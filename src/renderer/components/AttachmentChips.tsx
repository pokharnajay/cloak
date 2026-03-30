import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, FileText, Image, FileCode, File } from '@phosphor-icons/react'
import { useColors } from '../theme'
import type { Attachment } from '../../shared/types'

const FILE_ICONS: Record<string, React.ReactNode> = {
  'image/png': <Image size={14} />,
  'image/jpeg': <Image size={14} />,
  'image/gif': <Image size={14} />,
  'image/webp': <Image size={14} />,
  'image/svg+xml': <Image size={14} />,
  'text/plain': <FileText size={14} />,
  'text/markdown': <FileText size={14} />,
  'application/json': <FileCode size={14} />,
  'text/yaml': <FileCode size={14} />,
  'text/toml': <FileCode size={14} />,
}

function ImagePreview({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const colors = useColors()

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      data-clui-ui
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
      }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%' }}
      >
        <img
          src={src}
          alt={alt}
          style={{
            maxWidth: '100%',
            maxHeight: 'calc(100vh - 100px)',
            borderRadius: 0,
            border: `1px solid ${colors.containerBorder}`,
            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          }}
        />
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: -12,
            right: -12,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: colors.surfacePrimary,
            border: `1px solid ${colors.containerBorder}`,
            color: colors.textPrimary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={14} />
        </button>
      </motion.div>
    </motion.div>
  )
}

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: Attachment[]
  onRemove: (id: string) => void
}) {
  const colors = useColors()
  const [previewSrc, setPreviewSrc] = useState<{ src: string; alt: string } | null>(null)

  if (attachments.length === 0) return null

  return (
    <>
      <AnimatePresence>
        {previewSrc && (
          <ImagePreview src={previewSrc.src} alt={previewSrc.alt} onClose={() => setPreviewSrc(null)} />
        )}
      </AnimatePresence>

      <div data-clui-ui className="flex gap-1.5 pb-1" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
        <AnimatePresence mode="popLayout">
          {attachments.map((a) => (
            <motion.div
              key={a.id}
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.12 }}
              className="flex items-center gap-1.5 group flex-shrink-0"
              style={{
                background: colors.surfacePrimary,
                border: `1px solid ${colors.surfaceSecondary}`,
                borderRadius: 14,
                padding: a.dataUrl ? '3px 8px 3px 3px' : '4px 8px',
                maxWidth: 200,
              }}
            >
              {/* Image preview thumbnail — click to enlarge */}
              {a.dataUrl ? (
                <img
                  src={a.dataUrl}
                  alt={a.name}
                  className="rounded-[10px] object-cover flex-shrink-0"
                  style={{ width: 24, height: 24 }}
                  onClick={() => setPreviewSrc({ src: a.dataUrl!, alt: a.name })}
                />
              ) : (
                <span className="flex-shrink-0" style={{ color: colors.textTertiary }}>
                  {FILE_ICONS[a.mimeType || ''] || <File size={14} />}
                </span>
              )}

              {/* File name — click to preview if image */}
              <span
                className="text-[11px] font-medium truncate min-w-0 flex-1"
                style={{ color: colors.textPrimary }}
                onClick={() => a.dataUrl && setPreviewSrc({ src: a.dataUrl, alt: a.name })}
              >
                {a.name}
              </span>

              {/* Remove button */}
              <button
                onClick={() => onRemove(a.id)}
                className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: colors.textTertiary }}
              >
                <X size={10} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  )
}
