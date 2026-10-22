
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export default function CoachTutorial() {
  return (
    <div className="space-y-6">
      <Card className="bg-black/80 backdrop-blur-md border-white/30 shadow-xl">
        <CardHeader>
          <CardTitle className="text-white text-2xl">Welcome to Coaches Corner</CardTitle>
          <CardDescription className="text-white/80">
            Learn how to use the platform to review officials and manage your coaching profile
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1" className="border-white/20">
              <AccordionTrigger className="text-white hover:text-white/80">
                Getting Started
              </AccordionTrigger>
              <AccordionContent className="text-white/90 space-y-2">
                <p>Welcome to RateMyOfficial! This platform allows you to:</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>View and manage your coaching profile</li>
                  <li>See events where your team is participating</li>
                  <li>Review wrestling officials based on their performance</li>
                  <li>View all registered officials and their ratings</li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-2" className="border-white/20">
              <AccordionTrigger className="text-white hover:text-white/80">
                Managing Your Profile
              </AccordionTrigger>
              <AccordionContent className="text-white/90 space-y-2">
                <p>To update your coaching profile:</p>
                <ol className="list-decimal list-inside space-y-1 ml-4">
                  <li>Click on the "Manage Profile" tab</li>
                  <li>Update your information (name, school, years of coaching)</li>
                  <li>Upload a profile photo (optional but recommended)</li>
                  <li>Click "Update Profile" to save your changes</li>
                </ol>
                <p className="mt-2">Your school information is used to associate you with events where your team competes.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-3" className="border-white/20">
              <AccordionTrigger className="text-white hover:text-white/80">
                Viewing Your Events
              </AccordionTrigger>
              <AccordionContent className="text-white/90 space-y-2">
                <p>The "My Events" tab shows all wrestling events where your team is participating:</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>View event details including date, time, and venue</li>
                  <li>See which officials are assigned to each event</li>
                  <li>Click on any event to view full details</li>
                </ul>
                <p className="mt-2">
                  <strong>Note:</strong> Events are automatically linked to your profile based on your school/team affiliation.
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-4" className="border-white/20">
              <AccordionTrigger className="text-white hover:text-white/80">
                Reviewing Officials
              </AccordionTrigger>
              <AccordionContent className="text-white/90 space-y-2">
                <p>To submit a review for an official:</p>
                <ol className="list-decimal list-inside space-y-1 ml-4">
                  <li>Navigate to the "Officials" tab to see all registered officials</li>
                  <li>Click on an official's profile to view their details</li>
                  <li>Click "Leave a Review" or "Write Review"</li>
                  <li>Rate the official on six key criteria (1-5 stars each):
                    <ul className="list-disc list-inside ml-6 mt-1 space-y-1">
                      <li><strong>Mechanics:</strong> Proper positioning and movement on the mat</li>
                      <li><strong>Professionalism:</strong> Conduct and communication</li>
                      <li><strong>Positioning:</strong> Being in the right place to make calls</li>
                      <li><strong>Stalling:</strong> Consistency in calling stalling</li>
                      <li><strong>Consistency:</strong> Making similar calls in similar situations</li>
                      <li><strong>Appearance:</strong> Professional presentation and uniform</li>
                    </ul>
                  </li>
                  <li>Add optional comments to provide constructive feedback</li>
                  <li>Optionally upload a short video clip (if you have one)</li>
                  <li>Click "Submit Review"</li>
                </ol>
                <p className="mt-2 text-yellow-300">
                  <strong>Important:</strong> Reviews must be constructive and professional. Reviews are pending approval before being published.
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-5" className="border-white/20">
              <AccordionTrigger className="text-white hover:text-white/80">
                Understanding Ratings
              </AccordionTrigger>
              <AccordionContent className="text-white/90 space-y-2">
                <p>Each official's overall rating is calculated as an average of all six criteria:</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>⭐⭐⭐⭐⭐ (5.0) = Excellent</li>
                  <li>⭐⭐⭐⭐ (4.0-4.9) = Very Good</li>
                  <li>⭐⭐⭐ (3.0-3.9) = Good</li>
                  <li>⭐⭐ (2.0-2.9) = Needs Improvement</li>
                  <li>⭐ (1.0-1.9) = Poor</li>
                </ul>
                <p className="mt-2">
                  The goal is to provide honest, constructive feedback that helps officials improve their craft.
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-6" className="border-white/20">
              <AccordionTrigger className="text-white hover:text-white/80">
                Best Practices
              </AccordionTrigger>
              <AccordionContent className="text-white/90 space-y-2">
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>Be Specific:</strong> Reference specific situations or calls when possible</li>
                  <li><strong>Be Constructive:</strong> Focus on improvement, not just criticism</li>
                  <li><strong>Be Timely:</strong> Submit reviews soon after events while details are fresh</li>
                  <li><strong>Be Professional:</strong> Maintain a respectful tone in all feedback</li>
                  <li><strong>Be Honest:</strong> Your ratings help officials and the community</li>
                </ul>
                <p className="mt-2 text-yellow-300">
                  Remember: The purpose of this platform is to improve the quality of officiating through constructive feedback.
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-7" className="border-white/20">
              <AccordionTrigger className="text-white hover:text-white/80">
                FAQs
              </AccordionTrigger>
              <AccordionContent className="text-white/90 space-y-3">
                <div>
                  <p className="font-semibold">Q: Can I edit my review after submitting?</p>
                  <p className="ml-4">A: No, reviews cannot be edited once submitted. Please review carefully before submitting.</p>
                </div>
                <div>
                  <p className="font-semibold">Q: Are my reviews anonymous?</p>
                  <p className="ml-4">A: No, reviews are associated with your coaching profile to ensure accountability.</p>
                </div>
                <div>
                  <p className="font-semibold">Q: Why was my review not published?</p>
                  <p className="ml-4">A: Reviews are moderated to ensure they meet community standards. Reviews containing inappropriate content or personal attacks will not be approved.</p>
                </div>
                <div>
                  <p className="font-semibold">Q: How do I update my school/team?</p>
                  <p className="ml-4">A: Go to the "Manage Profile" tab and update your school field. This will automatically link you to relevant events.</p>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
