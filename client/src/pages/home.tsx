export default function Home() {
  return (
    <div className="min-h-screen w-full relative">
      {/* Content */}
      <div className="container mx-auto px-4 pt-16 pb-8 min-h-screen flex flex-col justify-between">
        {/* Quote at top (above officials' heads) */}
        <div className="text-center pt-8">
          <div className="p-6 max-w-2xl mx-auto">
            <blockquote className="text-lg italic text-white mb-2 drop-shadow-lg">
              "If you can't measure it, you can't improve it."
            </blockquote>
            <cite className="text-sm text-gray-200 drop-shadow-lg">-H. James Harrington</cite>
          </div>
        </div>
        
        {/* Coaching feedback at bottom (below officials' faces) */}
        <div className="text-center pb-16">
          <div className="p-6 max-w-3xl mx-auto">
            <p className="text-base text-white drop-shadow-lg leading-relaxed">
              Coaching feedback is the pressure that forges precision—turning effort into execution. Film, notes, and hard metrics convert opinions into proof, exposing habits and tightening mechanics. The same standard belongs to officials: evaluate positioning, timing, and consistency so the whistle is as sharp as the wrestling. Measure, correct, repeat—because excellence isn't an accident; it's a disciplined loop.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}