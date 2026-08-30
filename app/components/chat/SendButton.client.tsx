import { AnimatePresence, cubicBezier, motion } from 'framer-motion';

interface SendButtonProps {
  show: boolean;
  isStreaming?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
}

const customEasingFn = cubicBezier(0.16, 1, 0.3, 1);

export function SendButton({ show, isStreaming, onClick }: SendButtonProps) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.button
          className="absolute flex items-center justify-center top-[14px] right-[14px] w-[38px] h-[38px] rounded-xl bg-gradient-to-br from-accent-600 to-violet-600 text-white shadow-lg shadow-accent-500/25 hover:shadow-xl hover:shadow-accent-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 border border-white/10"
          transition={{ ease: customEasingFn, duration: 0.25 }}
          initial={{ opacity: 0, scale: 0.9, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 6 }}
          onClick={(event) => {
            event.preventDefault();
            onClick?.(event);
          }}
          aria-label={isStreaming ? 'Stop generation' : 'Send message'}
        >
          <div className="text-[18px] flex items-center justify-center">
            {!isStreaming ? <div className="i-ph:paper-plane-tilt-fill ml-[1px]" /> : <div className="i-ph:stop-fill" />}
          </div>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}
