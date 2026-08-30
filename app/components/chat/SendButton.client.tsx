import { AnimatePresence, cubicBezier, motion } from 'framer-motion';

interface SendButtonProps {
  show: boolean;
  isStreaming?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
}

const customEasingFn = cubicBezier(0.4, 0, 0.2, 1);

export function SendButton({ show, isStreaming, onClick }: SendButtonProps) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.button
          className="absolute flex items-center justify-center top-[12px] right-[10px] w-[32px] h-[32px] rounded-[6px] bg-[#1c1c1c] border border-[#2a2a2a] text-[#8a8a8a] hover:bg-[#242424] hover:text-[#e8e8e8] hover:border-[#2a2a2a] transition-colors"
          transition={{ ease: customEasingFn, duration: 0.15 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => {
            event.preventDefault();
            onClick?.(event);
          }}
          aria-label={isStreaming ? 'Stop generation' : 'Send message'}
        >
          <div className="text-[14px] flex items-center justify-center opacity-80">
            {!isStreaming ? <div className="i-ph:arrow-right" /> : <div className="i-ph:stop" />}
          </div>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}
