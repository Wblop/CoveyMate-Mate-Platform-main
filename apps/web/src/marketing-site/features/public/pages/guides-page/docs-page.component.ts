import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { UIPageHeaderComponent } from '@shared-ui/ui/page-header/page-header.component';
import { DocsGuidePage } from './docs-page.models';

const DOCS_PAGES: ReadonlyArray<DocsGuidePage> = [
  {
    slug: 'getting-started',
    navLabel: 'Getting started',
    title: 'Getting started with ConveyMate',
    description:
      'Use this guide to move from account sign in to your first completed property contract review report.',
    lastUpdated: '11 Mar 2026',
    sections: [
      {
        id: 'quickstart',
        title: 'Quickstart',
        paragraphs: [
          'ConveyMate reviews the contract pack for a property you are considering buying and returns a structured report covering risks, negotiation points, and a list of questions to raise with your solicitor or conveyancer.',
          'Follow this workflow from start to your first completed report.'
        ],
        bullets: [
          'Open Reports from the left workspace navigation to view any available records.',
          'Step 1 — Property details: Enter the property address, select the state or territory, and note your buyer context. Enabled jurisdictions are selectable; others show as Coming soon.',
          'Step 2 — Upload documents: Add your contract pack as PDF files. Include the contract of sale, any special conditions, disclosure documents, and title search where available.',
          'Step 3 — Review and confirm: Check your property details and accept the legal disclaimer before proceeding to payment.',
          'Step 4 — Payment and processing: Complete payment through Stripe checkout. Processing starts immediately after confirmation and most reports finish within 7 to 9 minutes. You can leave the page — the report continues in the background.',
          'Once status shows Ready, open the report to review your findings or download the PDF.'
        ]
      },
      {
        id: 'before-you-start',
        title: 'Before you start',
        paragraphs: [
          'ConveyMate accepts PDF files only. Scanned documents are supported, but text-based PDFs give better extraction quality and more accurate citations.',
          'Include the full contract pack where possible. The more complete your upload, the more thorough the analysis. Useful documents include the contract of sale, special conditions, section 32 or vendor statement, title search, and strata or owners corporation material if applicable.',
          'You do not need every document to proceed, but missing disclosures will appear as gaps or flagged unknowns in the report.'
        ]
      },
      {
        id: 'what-you-receive',
        title: 'What you receive',
        paragraphs: [
          'Each completed review produces a structured report with the sections below. Not every section appears in every report — optional sections only render when the analysis finds relevant content.'
        ],
        bullets: [
          'Decision snapshot: a high-level summary of the main findings and the most important actions to take before exchange.',
          'Priority risks: identified risks ranked High, Medium, or Low. Each item explains what was found, what it means for you, and what to do about it.',
          'Costs and compliance: estimated settlement costs, compliance observations, and financial items that warrant attention.',
          'Property condition: physical and building condition observations based on what is disclosed in the contract.',
          'Negotiation playbook: specific contract terms or conditions where you may have room to ask for changes.',
          'Contract conditions: special conditions, unusual clauses, and deviations from the standard contract form for your state.',
          'Questions for your conveyancer: a ready-to-use list of questions to raise at your first meeting with your solicitor or conveyancer.',
          'Downloadable PDF: a formatted version of the full report available from the report detail page once processing is complete.'
        ]
      },
      {
        id: 'jurisdiction-readiness',
        title: 'Jurisdiction availability',
        paragraphs: [
          'ConveyMate applies state-specific analysis based on the jurisdiction you select in Step 1. Each Australian state and territory has different disclosure requirements, standard contract forms, and conveyancing rules — the review reflects these differences.',
          'In the state selector, available jurisdictions are selectable. States not yet supported appear as Coming soon.'
        ],
        bullets: [
          'State-aware checklist and risk language.',
          'Jurisdiction-specific notices in the final report.',
          'One consistent workflow across all supported states and territories.'
        ]
      },
      {
        id: 'after-your-report',
        title: 'Requesting conveyancer quotes',
        paragraphs: [
          'Once your report is ready, use the Conveyancers directory to shortlist licensed firms in your state.',
          'Open Conveyancers from the workspace navigation to review firms, compare jurisdictions, and continue your outreach manually.',
          'You control whether conveyancers can access your full report.',
          'Use Conveyancers to filter by state or territory and search by name or firm to browse licensed practitioners in your area.'
        ]
      },
      {
        id: 'faq',
        title: 'FAQ',
        paragraphs: ['Common questions from first-time users.'],
        bullets: [
          'How long does processing take? Most reports complete within 7 to 9 minutes. Use the live stage updates in Step 4 for the most accurate estimate for your specific upload.',
          'Can I leave the page while processing runs? Yes. Processing continues in the background. Reopen the report from the Reports section when it is ready.',
          'Can I change documents after paying? No. Uploads are locked once the review starts. If documents change, rely on the conveyancer review process outside ConveyMate.',
          'What if my state is not available yet? Check the Step 1 selector for currently supported jurisdictions. More states are being added over time.',
          'Is this legal advice? No. ConveyMate provides structured contract information to help you understand your contract. Always engage a qualified solicitor or conveyancer before signing or exchanging.'
        ]
      }
    ]
  },
  {
    slug: 'account-access',
    navLabel: 'Account & access',
    title: 'Account access and sign-in support',
    description:
      'Resolve account issues quickly, including password reset flow, email verification, session expiry, and browser compatibility.',
    lastUpdated: '11 Mar 2026',
    sections: [
      {
        id: 'sign-in-methods',
        title: 'Sign-in options',
        paragraphs: [
          'ConveyMate supports two ways to sign in: email and password, or Google. Both give full access to the same features.',
          'If you created your account using Google, you must continue to sign in with Google. You cannot set a separate email password for an account created through Google sign-in.'
        ]
      },
      {
        id: 'sign-in-issues',
        title: 'Common sign-in issues',
        paragraphs: ['Run through these checks before escalating to support.'],
        bullets: [
          'Confirm the email address you are entering exactly matches your registered address, including any dots or plus symbols.',
          'Check whether your password manager has filled in an outdated password — clear the field and type it manually to confirm.',
          'Disable browser extensions that block scripts or network requests. Ad blockers and some privacy tools interfere with authentication.',
          'Make sure your device clock is set correctly. Authentication tokens are time-sensitive and an incorrect device time causes repeated failures.'
        ]
      },
      {
        id: 'reset-password',
        title: 'Reset your password',
        paragraphs: [
          'Go to the sign-in page and select Forgot password. Enter your registered email address and submit.',
          'If the address matches an account, ConveyMate sends a reset link by email. The link is valid for a limited time — if it expires, return to Forgot password and request a new one.',
          'Check your spam or junk folder if the email does not arrive within a few minutes. Once you have reset your password, sign in again with the new one.'
        ]
      },
      {
        id: 'email-verification',
        title: 'Email verification for new accounts',
        paragraphs: [
          'When you create an account with email and password, ConveyMate sends a 6-digit verification code to your registered address. You must enter this code before your account is fully active.',
          'If the code does not arrive within a few minutes, check your spam or junk folder. If the code has expired, select Request new code on the verification screen to receive a fresh one.',
          'Accounts created through Google sign-in do not require a separate verification step.'
        ]
      },
      {
        id: 'browser-compatibility',
        title: 'Browser compatibility',
        paragraphs: ['ConveyMate is tested against current versions of the following browsers.'],
        bullets: ['Google Chrome', 'Microsoft Edge', 'Safari 17 or later', 'Mozilla Firefox']
      },
      {
        id: 'session-security',
        title: 'Session expiry and sign-out behaviour',
        paragraphs: [
          'Your session can expire automatically after a period of inactivity, or be invalidated if your account security settings change.',
          'If you are signed out unexpectedly, sign in again and retry what you were doing. If unexpected sign-outs keep happening, close any stale browser tabs and contact support with your browser name, version, and a description of when it occurs.'
        ]
      }
    ]
  },
  {
    slug: 'payments',
    navLabel: 'Payments',
    title: 'Payment and billing help',
    description:
      'Understand payment timing, accepted methods, and what to do if checkout fails before report processing starts.',
    lastUpdated: '11 Mar 2026',
    sections: [
      {
        id: 'pricing-and-charge-timing',
        title: 'When you are charged',
        paragraphs: [
          'Each report requires a single payment before processing begins. You are charged at the moment Stripe confirms your payment — not when you submit documents or when the report is delivered.',
          'Until payment is confirmed, your uploaded documents are held and no analysis runs. Once payment clears, the report moves into the processing queue automatically.'
        ]
      },
      {
        id: 'payment-status-flow',
        title: 'Payment status labels',
        paragraphs: ['The report status label tells you where your review sits in the payment and processing sequence.'],
        bullets: [
          'Awaiting payment: documents are uploaded and checkout is ready. No processing has started.',
          'Queued: payment is confirmed and the report is waiting for the next available processing slot.',
          'Processing: analysis is actively running. Live stage updates are available from the report.',
          'Ready: the report completed successfully and is available to view and download.',
          'Failed: processing stopped due to an error. Contact support with the report ID if this occurs.'
        ]
      },
      {
        id: 'accepted-methods',
        title: 'Accepted payment methods',
        paragraphs: ['ConveyMate uses Stripe for checkout. Available payment methods depend on your device and browser.'],
        bullets: [
          'Visa and Mastercard credit and debit cards.',
          'Apple Pay, where your device and browser are eligible.',
          'Google Pay and Link, where available in your current browser session.'
        ]
      },
      {
        id: 'payment-failures',
        title: 'If payment fails or checkout does not load',
        paragraphs: ['Try these steps in order if checkout does not appear or a payment is declined.'],
        bullets: [
          'Refresh the page and open checkout again from the same report.',
          'Retry in a fresh browser session without ad blockers or privacy extensions enabled.',
          'Confirm your browser allows third-party scripts. Some content blockers prevent the Stripe checkout from loading.',
          'If the problem continues, note the report ID and the time of the failure and contact support.'
        ]
      },
      {
        id: 'refunds-and-retries',
        title: 'Duplicate charges and refunds',
        paragraphs: [
          'ConveyMate is designed to prevent duplicate charges if you retry checkout. If you see multiple pending amounts, only one will settle — the others drop off automatically. If a duplicate does settle, contact support and it will be resolved.',
          'A successfully generated report is not refundable for change-of-mind reasons. Each review involves real processing costs that run regardless of the outcome.',
          'A refund is available if the report pipeline fails and no report is delivered, or if the report contains a verified material error — such as fabricated facts or citations — that cannot be corrected within a reasonable time. These refunds are assessed individually and are subject to Australian Consumer Law.'
        ],
        bullets: [
          'No refund for a successfully delivered report if you change your mind.',
          'Refund available if processing fails and the report is not delivered.',
          'Refund available for verified material report errors that cannot be corrected.'
        ]
      },
      {
        id: 'charge-visibility',
        title: 'Payment confirmed but status has not updated',
        paragraphs: [
          'If your bank or card app shows a charge but the report still shows Awaiting payment, give it a minute and refresh the page. Payment confirmation can take a moment to register.',
          'If the status has not updated after several minutes, contact support with your payment timestamp, the report ID, and a description of what you see.'
        ]
      }
    ]
  },
  {
    slug: 'ai-review-pipeline',
    navLabel: 'Review workflow',
    title: 'How the review workflow works',
    description:
      'Detailed view of how ConveyMate ingests contract evidence, routes jurisdiction knowledge, and produces structured report outputs.',
    lastUpdated: '11 Mar 2026',
    sections: [
      {
        id: 'pipeline-overview',
        title: 'Pipeline overview',
        paragraphs: [
          'After payment confirmation, ConveyMate runs a background review pipeline that processes your contract pack and produces a structured report. Most reports complete within 7 to 9 minutes.',
          'The app stays fully usable while processing runs. You can leave the page and return later — the report will be available under Ready when it finishes.'
        ]
      },
      {
        id: 'pre-processing-and-ocr',
        title: 'Document extraction and OCR',
        paragraphs: [
          'Each uploaded PDF is processed individually. Documents with selectable text are extracted directly. Scanned or image-based pages go through optical character recognition (OCR) to recover the text.',
          'Extracted content is broken into structured sections and linked back to their source document and page number. This is what allows findings in your report to be cited against specific parts of your contract pack.'
        ]
      },
      {
        id: 'rag-and-embeddings',
        title: 'Evidence retrieval before analysis',
        paragraphs: [
          'Before any analysis runs, ConveyMate retrieves the most relevant passages from your uploaded documents. The workflow works from specific contract evidence rather than relying on general knowledge alone.',
          'Retrieval is targeted — the system finds the most relevant sections for each analysis task rather than processing the entire document at once. This keeps findings anchored to what your contract actually says.'
        ]
      },
      {
        id: 'jurisdiction-collections',
        title: 'Jurisdiction knowledge and framework routing',
        paragraphs: [
          'Each jurisdiction has its own standard contract form, disclosure requirements, cooling-off rules, and compliance obligations. ConveyMate routes your review through the relevant state or territory framework based on the jurisdiction you selected in Step 1.',
          'This affects the language of the checklist, which disclosures are flagged as missing, and how risk items are described. A NSW review applies different rules to a VIC or QLD review.'
        ],
        bullets: [
          'State-specific disclosure requirements applied to the checklist.',
          'Jurisdiction-aware risk wording and compliance references.',
          'Common Australian property law principles applied across all reviews.'
        ]
      },
      {
        id: 'external-context-enrichment',
        title: 'Location context',
        paragraphs: [
          'For some properties, the pipeline adds publicly available location context tied to the property address — such as planning zone information, flood or bushfire overlays, or suburb-level property data.',
          'This context is treated as supporting information and clearly separated from findings drawn directly from your uploaded documents. It is not a substitute for a full planning or environmental search, which your conveyancer can arrange.'
        ]
      },
      {
        id: 'processing-stages',
        title: 'Processing stages',
        paragraphs: ['The report detail page shows live stage updates as the pipeline progresses. Stages run in this order:'],
        bullets: [
          'Setup: the review is being prepared — covers Awaiting upload, Awaiting payment, and Queued.',
          'Extracting: your PDF documents are being read and converted to structured text.',
          'Indexing: extracted content is being organised for targeted retrieval.',
          'Analysing: the review engine is assessing evidence against your jurisdiction framework and producing findings.',
          'Validating: citations, consistency, and completeness are being checked.',
          'Rendering: the report is being assembled into its final structure.',
          'Completed: the report is ready to view and download.',
          'Failed: the pipeline stopped before completing. Contact support with your report ID.'
        ]
      },
      {
        id: 'hallucination-controls',
        title: 'Accuracy and quality controls',
        paragraphs: [
          'ConveyMate is designed to keep findings grounded in what your documents actually say. The pipeline retrieves specific evidence before generating each section, and runs consistency and citation checks after generation.',
          'When evidence is absent or ambiguous, the report flags uncertainty rather than filling gaps with unsupported conclusions.',
          'No automated system is perfect. Treat the report as a well-informed starting point for your conversation with a qualified conveyancer, not a definitive legal assessment.'
        ],
        bullets: [
          'Evidence retrieved from your documents before each analysis pass.',
          'Post-generation checks for citation integrity and consistency.',
          'Explicit uncertainty flagging when evidence is incomplete or missing.'
        ]
      },
      {
        id: 'legal-boundary',
        title: 'Legal boundary',
        paragraphs: [
          'ConveyMate provides structured contract information to help you understand your contract. It is not legal advice and does not replace a qualified solicitor or conveyancer.',
          'Always obtain independent legal advice before signing, exchanging, or making any changes to a property contract.'
        ]
      }
    ]
  },
  {
    slug: 'report-results',
    navLabel: 'Understanding reports',
    title: 'How to read your report',
    description:
      'Use this guide to interpret risk severity, checklist outcomes, and the recommended questions to raise with your legal adviser.',
    lastUpdated: '11 Mar 2026',
    sections: [
      {
        id: 'report-structure',
        title: 'Report sections',
        paragraphs: [
          'A completed report is divided into tabbed sections. Not every section appears in every report — tabs that are not relevant to a particular property or contract are omitted.'
        ],
        bullets: [
          'Overview: the decision snapshot, a high-level summary of the main findings and the most important actions to take before exchange.',
          'Risks and next steps: each identified risk, ranked by priority, with a description of what was found, its impact, and what to do about it.',
          'Costs and compliance: estimated settlement costs, compliance observations, and financial items that warrant attention.',
          'Property condition: physical and building condition observations based on what is disclosed in the contract documents.',
          'Negotiation: specific contract terms or conditions where you may have leverage as the buyer.',
          'Contract conditions: special conditions, unusual clauses, and anything that deviates from the standard contract form for your jurisdiction.',
          'Questions for your conveyancer: targeted questions to raise at your first meeting with your solicitor or conveyancer.'
        ]
      },
      {
        id: 'pdf-download',
        title: 'Downloading the report',
        paragraphs: [
          'Once the report status shows Ready, a Download PDF button appears on the report detail page. The PDF contains all sections in a formatted layout suitable for printing or sharing with your solicitor.',
          'If the download does not start, refresh the page and try again. Contact support if the issue persists after payment has been confirmed.'
        ]
      },
      {
        id: 'status-guidance',
        title: 'Report is not ready yet',
        paragraphs: [
          'Draft means setup is incomplete. Return to the report and continue from where you left off — you may need to complete uploads, confirm property details, or complete payment.',
          'Processing means the review is actively running. Open the report to see live stage updates.',
          'Failed means something went wrong during processing. Contact support at support@conveymate.com.au with your report ID.'
        ]
      },
      {
        id: 'risk-priority',
        title: 'Risk priority levels',
        paragraphs: ['Each risk item carries a priority label. Use these to decide what to raise with your adviser first.'],
        bullets: [
          'High: a legal or financial exposure that needs urgent clarification before you proceed. Do not exchange without getting advice on High-priority risks.',
          'Medium: an important contract detail that warrants attention but may be resolvable through discussion or negotiation.',
          'Low: a contextual item worth monitoring. Less urgent, but worth mentioning to your conveyancer.'
        ]
      },
      {
        id: 'questions-for-lawyer',
        title: 'Questions for your solicitor or conveyancer',
        paragraphs: [
          'The questions section gives you a starting brief for your first meeting with your legal adviser. The questions are drawn from findings in your report and are written to be practical and specific.',
          'Focus first on questions related to missing disclosures, special conditions that override standard terms, settlement uncertainty, and title encumbrances or caveats.',
          'These questions are a guide, not a substitute for legal advice. Your solicitor or conveyancer may raise additional issues based on their own review of the full contract.'
        ]
      },
      {
        id: 'confidence-and-gaps',
        title: 'Confidence, assumptions, and gaps',
        paragraphs: [
          'When the report cannot find evidence for something — because it is missing from the documents, unclear, or ambiguous — it says so explicitly rather than making assumptions.',
          'Sections marked as estimates or based on limited evidence should be treated as guidance only. Ask your conveyancer to confirm specifics, particularly around costs, settlement dates, and planning obligations.',
          'If you believe the report missed something important or contains an error, contact support with the report ID and a description of the issue.'
        ]
      },
      {
        id: 'next-steps',
        title: 'Next steps after your report',
        paragraphs: [
          'Use the report as preparation material for your legal review, not a replacement for it. Share the key findings and question list with your solicitor or conveyancer at your first meeting.',
          'If you have not yet engaged a conveyancer, use the Conveyancers directory to shortlist licensed firms in your state and continue outreach manually.'
        ]
      }
    ]
  },
  {
    slug: 'troubleshooting',
    navLabel: 'Troubleshooting',
    title: 'Troubleshooting and support',
    description:
      'Resolve common upload, processing, and payment issues quickly before escalating to support.',
    lastUpdated: '11 Mar 2026',
    sections: [
      {
        id: 'upload-errors',
        title: 'Upload failures',
        paragraphs: ['If your upload fails, check these common causes first.'],
        bullets: [
          'ConveyMate accepts PDF files only. Word documents, images, and other file types are not supported.',
          'Make sure the file is not password protected, locked for editing, or corrupted. Try opening it in a PDF viewer to confirm it is readable.',
          'Disable script-blocking browser extensions that may interrupt the upload. Ad blockers and privacy tools can prevent files from reaching the server.',
          'A stable internet connection is needed during upload. If your connection dropped mid-upload, remove the file and add it again.',
          'If a specific file keeps failing while others succeed, try re-saving or re-exporting it from the source application and uploading the new version.'
        ]
      },
      {
        id: 'draft-resume',
        title: 'Draft asks for uploads again',
        paragraphs: [
          'When you resume a draft after closing the browser or starting a new session, ConveyMate may ask you to upload your documents again. File references from the previous session are no longer available after the session ends.',
          'Your property details and other information are saved. Re-upload the same documents in Step 2 and continue through to payment. You will not be charged again for the same report.'
        ]
      },
      {
        id: 'processing-delays',
        title: 'Report appears stuck or taking longer than expected',
        paragraphs: [
          'Most reports complete within 7 to 9 minutes. Large contract packs — particularly those with many scanned pages — can take longer in the extraction and indexing stages.',
          'Open the report detail page and check the current stage and the time of the last update. If the stage has not changed for more than 20 minutes, the job may have stalled.',
          'Contact support with the report ID and the last visible stage if you believe processing has stopped unexpectedly.'
        ]
      },
      {
        id: 'failed-report',
        title: 'Report status shows Failed',
        paragraphs: [
          'A Failed status means the pipeline stopped before completing the report. This can happen due to document quality issues, extraction failures, or an infrastructure problem.',
          'Contact support at support@conveymate.com.au with your report ID and any error message visible on screen. Include the last pipeline stage you saw if it is visible.',
          'If the failure was caused by a problem on our side, we will either re-run your report or arrange a refund.'
        ]
      },
      {
        id: 'payment-issues',
        title: 'Payment problems',
        paragraphs: [
          'If the Stripe checkout does not appear, refresh the page and try opening it again from the same report.',
          'If payment completed in your bank or card app but the report still shows Awaiting payment after a few minutes, contact support. Include the report ID and the approximate time the payment was made.'
        ]
      },
      {
        id: 'contact-support',
        title: 'Contacting support',
        paragraphs: [
          'Email support@conveymate.com.au for help with account, payment, upload, and report issues.',
          'To help us resolve your issue quickly, include the following: your report ID (visible in the URL or on the report detail page), the time the problem occurred including your timezone, your browser name and version, and a brief description of what happened and what you expected.',
          'For payment issues, add the payment timestamp from your bank or card statement. For processing issues, include the last pipeline stage you saw before the problem occurred.'
        ]
      }
    ]
  }
].map((page, index) => ({
  ...page,
  isIndexPage: index === 0
}));

const DEFAULT_DOCS_PAGE = DOCS_PAGES[0];

const MERGED_DOCS_PAGES = DOCS_PAGES;

@Component({
  selector: 'app-docs-page',
  standalone: true,
  imports: [RouterLink, UIPageHeaderComponent],
  templateUrl: './docs-page.component.html',
  styleUrl: './docs-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocsPageComponent implements AfterViewInit {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly initialPage = resolveGuidePage(this.route.snapshot.paramMap.get('page'));

  private sectionObserver: IntersectionObserver | null = null;

  readonly docsPages = MERGED_DOCS_PAGES;
  readonly currentPage = signal<DocsGuidePage>(this.initialPage);
  readonly activeSectionId = signal<string>(this.initialPage.sections[0]?.id ?? '');

  constructor() {
    this.route.paramMap.subscribe((params) => {
      const selected = resolveGuidePage(params.get('page'));
      this.currentPage.set(selected);
      this.activeSectionId.set(selected.sections[0]?.id ?? '');
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
      this.queueSectionObserverSetup();
    });

    this.route.fragment.subscribe((fragment) => {
      if (!fragment) {
        return;
      }

      this.queueFragmentScroll(fragment);
    });

    this.destroyRef.onDestroy(() => {
      this.sectionObserver?.disconnect();
      this.sectionObserver = null;
    });
  }

  ngAfterViewInit(): void {
    this.queueSectionObserverSetup();
  }

  pageRoute(page: DocsGuidePage): string | string[] {
    const basePath = this.docsBasePath();
    return page.isIndexPage ? basePath : [basePath, page.slug];
  }

  scrollToSection(event: Event, sectionId: string): void {
    event.preventDefault();
    if (typeof window === 'undefined') {
      return;
    }

    const target = document.getElementById(sectionId);
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: this.prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    this.activeSectionId.set(sectionId);
    window.history.replaceState(null, '', `${window.location.pathname}#${sectionId}`);
  }

  private queueSectionObserverSetup(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.setTimeout(() => this.setupSectionObserver(), 0);
  }

  private queueFragmentScroll(fragment: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.setTimeout(() => {
      const target = document.getElementById(fragment);
      if (!target) {
        return;
      }

      target.scrollIntoView({ behavior: 'auto', block: 'start' });
      this.activeSectionId.set(fragment);
    }, 0);
  }

  private docsBasePath(): '/guides' {
    return '/guides';
  }

  private setupSectionObserver(): void {
    this.sectionObserver?.disconnect();
    this.sectionObserver = null;

    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const sectionNodes = Array.from(document.querySelectorAll<HTMLElement>('.docs-anchor'));
    if (sectionNodes.length === 0) {
      return;
    }

    this.activeSectionId.set(sectionNodes[0].id);

    this.sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top));

        const closest = visible[0]?.target;
        if (closest instanceof HTMLElement && closest.id) {
          this.activeSectionId.set(closest.id);
        }
      },
      {
        root: null,
        rootMargin: '-120px 0px -65% 0px',
        threshold: [0.1, 0.3, 0.6]
      }
    );

    sectionNodes.forEach((node) => this.sectionObserver?.observe(node));
  }

  private prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}

function mergeDocsPages(staticPages: ReadonlyArray<DocsGuidePage>, generatedPages: ReadonlyArray<DocsGuidePage>): ReadonlyArray<DocsGuidePage> {
  const pagesBySlug = new Map<string, DocsGuidePage>();

  for (const page of staticPages) {
    pagesBySlug.set(page.slug, page);
  }

  for (const page of generatedPages) {
    pagesBySlug.set(page.slug, page);
  }

  return Array.from(pagesBySlug.values());
}

function resolveGuidePage(slug: string | null): DocsGuidePage {
  const normalizedSlug = normalizeGuideSlug(slug);
  if (!normalizedSlug) {
    return DEFAULT_DOCS_PAGE;
  }

  return DOCS_PAGES.find((page) => page.slug === normalizedSlug) ?? createMissingGuidePage(normalizedSlug);
}

function normalizeGuideSlug(value: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

function createMissingGuidePage(slug: string): DocsGuidePage {
  return {
    slug,
    navLabel: 'Unpublished guide',
    title: 'Guide not found',
    description: 'This guide is not in the latest published guides bundle.',
    lastUpdated: '11 Mar 2026',
    sections: [
      {
        id: 'unpublished',
        title: 'No published guide yet',
        paragraphs: [
          `ConveyMate does not have a published guide for ${humanizeGuideSlug(slug)} yet.`,
          'Only guides that exist in the latest published guides bundle are rendered on the marketing site.'
        ],
        bullets: ['Return to the guides index for published content.', 'Use calculators or create a report for current product workflows.']
      }
    ]
  };
}

function humanizeGuideSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
