interface TutorialStepProps {
  number: number
  text: string
  link?: string
}

export function TutorialStep({ number, text, link }: TutorialStepProps) {
  return (
    <div className="flex gap-3">
      <div className="flex items-center justify-center size-6 rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0">
        {number}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {link ? (
          <>
            Go to{' '}
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {new URL(link).hostname}
            </a>
          </>
        ) : (
          text
        )}
      </p>
    </div>
  )
}
