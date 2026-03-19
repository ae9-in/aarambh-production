"use client";

import React, { useRef } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  MotionValue,
} from "framer-motion";



// ================= CONTAINER =================

export const ContainerScroll = ({
  titleComponent,
  children,
}: {
  titleComponent: string | React.ReactNode;
  children: React.ReactNode;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    // Make progress start when the component top hits the viewport top,
    // so the card is visible immediately (no long "blank" gap).
    offset: ["start start", "end end"],
  });

  const rotate = useTransform(scrollYProgress, [0, 1], [8, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1.05, 1]);
  // Keep vertical motion subtle to avoid large blank bands on small screens.
  const translate = useTransform(scrollYProgress, [0, 1], [0, -20]);

  return (
    <div
      ref={containerRef}
      className="relative min-h-[72vh] md:min-h-[90vh] flex items-center justify-center px-2 sm:px-3 md:px-8 py-0"
    >
      <div
        className="py-0 md:py-8 w-full relative"
        style={{ perspective: "1000px" }}
      >
        <Header translate={translate} titleComponent={titleComponent} />

        <Card rotate={rotate} scale={scale} translate={translate}>
          {children}
        </Card>
      </div>
    </div>
  );
};



// ================= HEADER =================

export const Header = ({ translate, titleComponent }: any) => {
  return (
    <motion.div
      style={{ translateY: translate }}
      className="max-w-5xl mx-auto text-center"
    >
      {titleComponent}
    </motion.div>
  );
};



// ================= CARD =================

export const Card = ({
  rotate,
  scale,
  translate,
  children,
}: {
  rotate: MotionValue<number>;
  scale: MotionValue<number>;
  translate: MotionValue<number>;
  children: React.ReactNode;
}) => {
  const [hovered, setHovered] = React.useState(false);

  const smoothRotate = useSpring(rotate, {
    stiffness: 60,
    damping: 20,
  });

  const smoothScale = useSpring(scale, {
    stiffness: 60,
    damping: 20,
  });

  return (
    <motion.div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      animate={{
        rotateX: hovered ? 0 : smoothRotate.get(),
        scale: hovered ? 1.03 : smoothScale.get(),
      }}
      transition={{
        type: "spring",
        stiffness: 30,
        damping: 20,
        mass: 1.5,
      }}
      style={{
        translateY: translate,
        transformStyle: "preserve-3d",
      }}
      className="mx-auto -mt-2 md:-mt-16 h-[24rem] sm:h-[28rem] md:h-[40rem] w-[calc(100%-0.25rem)] sm:w-[calc(100%-0.5rem)] md:w-full max-w-[96vw] md:max-w-5xl border-2 sm:border-4 border-[#FF6B35] p-1.5 sm:p-2 md:p-6 bg-[#1C1917] rounded-[22px] sm:rounded-[26px] md:rounded-[30px] shadow-[0_12px_30px_rgba(0,0,0,0.25)] md:shadow-[0_24px_60px_rgba(0,0,0,0.35)]"
    >
      <div className="h-full w-full overflow-hidden rounded-[16px] sm:rounded-2xl bg-[#FAF9F7] dark:bg-[#1C1917] md:p-4">
        {children}
      </div>
    </motion.div>
  );
};