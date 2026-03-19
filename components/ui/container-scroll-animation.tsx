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

  const rotate = useTransform(scrollYProgress, [0, 1], [20, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1.05, 1]);
  // Keep vertical motion subtle to avoid large blank bands on small screens.
  const translate = useTransform(scrollYProgress, [0, 1], [0, -36]);

  return (
    <div
      ref={containerRef}
      className="relative min-h-[72vh] md:min-h-[90vh] flex items-center justify-center p-0 md:p-8"
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
        boxShadow:
          "0 0 #0000004d, 0 9px 20px #0000004a, 0 37px 37px #00000042, 0 84px 50px #00000026, 0 149px 60px #0000000a, 0 233px 65px #00000003",
      }}
      className="max-w-5xl -mt-2 mx-auto h-[25rem] sm:h-[28rem] md:h-[40rem] w-full border-4 border-[#FF6B35] p-2 md:p-6 bg-[#1C1917] rounded-[30px] md:-mt-16"
    >
      <div className="h-full w-full overflow-hidden rounded-2xl bg-[#FAF9F7] dark:bg-[#1C1917] md:p-4">
        {children}
      </div>
    </motion.div>
  );
};