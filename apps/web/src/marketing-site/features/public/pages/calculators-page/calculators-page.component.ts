import { CurrencyPipe } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Chart } from 'chart.js';

import { UIButtonComponent } from '@shared-ui/ui/button/button.component';
import { UIFormFieldComponent } from '@shared-ui/ui/form-field/form-field.component';

type StateCode = 'ACT' | 'NSW' | 'NT' | 'QLD' | 'SA' | 'TAS' | 'VIC' | 'WA';

interface StateOption {
  code: StateCode;
  label: string;
}

interface StampDutyBracket {
  upTo: number | null;
  threshold: number;
  baseDuty: number;
  marginalRate: number;
}

interface FirstHomeConcession {
  fullExemptionUpTo: number;
  concessionEndsAt: number;
}

interface StateCostConfig {
  stampDutyBrackets: ReadonlyArray<StampDutyBracket>;
  firstHomeConcession?: FirstHomeConcession;
  transferRegistrationFee: number;
  mortgageRegistrationFee: number;
  governmentSearchesFee: number;
  defaultSolicitorFee: number;
}

interface MortgageProjectionPoint {
  label: string;
  remainingBalance: number;
  cumulativePrincipal: number;
  cumulativeInterest: number;
}

const STATE_OPTIONS: ReadonlyArray<StateOption> = [
  { code: 'NSW', label: 'New South Wales' },
  { code: 'VIC', label: 'Victoria' },
  { code: 'QLD', label: 'Queensland' },
  { code: 'WA', label: 'Western Australia' },
  { code: 'SA', label: 'South Australia' },
  { code: 'ACT', label: 'Australian Capital Territory' },
  { code: 'TAS', label: 'Tasmania' },
  { code: 'NT', label: 'Northern Territory' }
];

const STATE_COST_CONFIG: Record<StateCode, StateCostConfig> = {
  NSW: {
    stampDutyBrackets: [
      { upTo: 14_000, threshold: 0, baseDuty: 0, marginalRate: 0.0125 },
      { upTo: 30_000, threshold: 14_000, baseDuty: 175, marginalRate: 0.015 },
      { upTo: 80_000, threshold: 30_000, baseDuty: 415, marginalRate: 0.0175 },
      { upTo: 300_000, threshold: 80_000, baseDuty: 1_290, marginalRate: 0.035 },
      { upTo: 1_000_000, threshold: 300_000, baseDuty: 8_990, marginalRate: 0.045 },
      { upTo: 3_000_000, threshold: 1_000_000, baseDuty: 40_490, marginalRate: 0.055 },
      { upTo: null, threshold: 3_000_000, baseDuty: 150_490, marginalRate: 0.07 }
    ],
    firstHomeConcession: {
      fullExemptionUpTo: 800_000,
      concessionEndsAt: 1_000_000
    },
    transferRegistrationFee: 188,
    mortgageRegistrationFee: 177,
    governmentSearchesFee: 360,
    defaultSolicitorFee: 2_450
  },
  VIC: {
    stampDutyBrackets: [
      { upTo: 25_000, threshold: 0, baseDuty: 0, marginalRate: 0.014 },
      { upTo: 130_000, threshold: 25_000, baseDuty: 350, marginalRate: 0.024 },
      { upTo: 960_000, threshold: 130_000, baseDuty: 2_870, marginalRate: 0.06 },
      { upTo: 2_000_000, threshold: 960_000, baseDuty: 52_670, marginalRate: 0.055 },
      { upTo: null, threshold: 2_000_000, baseDuty: 109_870, marginalRate: 0.065 }
    ],
    firstHomeConcession: {
      fullExemptionUpTo: 600_000,
      concessionEndsAt: 750_000
    },
    transferRegistrationFee: 108,
    mortgageRegistrationFee: 134,
    governmentSearchesFee: 320,
    defaultSolicitorFee: 2_380
  },
  QLD: {
    stampDutyBrackets: [
      { upTo: 5_000, threshold: 0, baseDuty: 0, marginalRate: 0 },
      { upTo: 75_000, threshold: 5_000, baseDuty: 0, marginalRate: 0.015 },
      { upTo: 540_000, threshold: 75_000, baseDuty: 1_050, marginalRate: 0.035 },
      { upTo: 1_000_000, threshold: 540_000, baseDuty: 17_325, marginalRate: 0.045 },
      { upTo: null, threshold: 1_000_000, baseDuty: 38_025, marginalRate: 0.0575 }
    ],
    firstHomeConcession: {
      fullExemptionUpTo: 700_000,
      concessionEndsAt: 800_000
    },
    transferRegistrationFee: 222,
    mortgageRegistrationFee: 230,
    governmentSearchesFee: 345,
    defaultSolicitorFee: 2_300
  },
  WA: {
    stampDutyBrackets: [
      { upTo: 120_000, threshold: 0, baseDuty: 0, marginalRate: 0.019 },
      { upTo: 150_000, threshold: 120_000, baseDuty: 2_280, marginalRate: 0.0285 },
      { upTo: 360_000, threshold: 150_000, baseDuty: 3_135, marginalRate: 0.038 },
      { upTo: 725_000, threshold: 360_000, baseDuty: 11_115, marginalRate: 0.0475 },
      { upTo: null, threshold: 725_000, baseDuty: 28_452, marginalRate: 0.0515 }
    ],
    firstHomeConcession: {
      fullExemptionUpTo: 450_000,
      concessionEndsAt: 600_000
    },
    transferRegistrationFee: 204,
    mortgageRegistrationFee: 231,
    governmentSearchesFee: 350,
    defaultSolicitorFee: 2_220
  },
  SA: {
    stampDutyBrackets: [
      { upTo: 12_000, threshold: 0, baseDuty: 0, marginalRate: 0.01 },
      { upTo: 30_000, threshold: 12_000, baseDuty: 120, marginalRate: 0.02 },
      { upTo: 50_000, threshold: 30_000, baseDuty: 480, marginalRate: 0.03 },
      { upTo: 100_000, threshold: 50_000, baseDuty: 1_080, marginalRate: 0.035 },
      { upTo: 200_000, threshold: 100_000, baseDuty: 2_830, marginalRate: 0.04 },
      { upTo: 250_000, threshold: 200_000, baseDuty: 6_830, marginalRate: 0.0425 },
      { upTo: 300_000, threshold: 250_000, baseDuty: 8_955, marginalRate: 0.0475 },
      { upTo: 500_000, threshold: 300_000, baseDuty: 11_330, marginalRate: 0.05 },
      { upTo: null, threshold: 500_000, baseDuty: 21_330, marginalRate: 0.055 }
    ],
    transferRegistrationFee: 203,
    mortgageRegistrationFee: 198,
    governmentSearchesFee: 330,
    defaultSolicitorFee: 2_180
  },
  ACT: {
    stampDutyBrackets: [
      { upTo: 200_000, threshold: 0, baseDuty: 0, marginalRate: 0.002 },
      { upTo: 300_000, threshold: 200_000, baseDuty: 400, marginalRate: 0.022 },
      { upTo: 500_000, threshold: 300_000, baseDuty: 2_600, marginalRate: 0.034 },
      { upTo: 750_000, threshold: 500_000, baseDuty: 9_400, marginalRate: 0.0432 },
      { upTo: null, threshold: 750_000, baseDuty: 20_200, marginalRate: 0.059 }
    ],
    firstHomeConcession: {
      fullExemptionUpTo: 650_000,
      concessionEndsAt: 900_000
    },
    transferRegistrationFee: 184,
    mortgageRegistrationFee: 182,
    governmentSearchesFee: 310,
    defaultSolicitorFee: 2_420
  },
  TAS: {
    stampDutyBrackets: [
      { upTo: 3_000, threshold: 0, baseDuty: 50, marginalRate: 0 },
      { upTo: 25_000, threshold: 3_000, baseDuty: 50, marginalRate: 0.0175 },
      { upTo: 75_000, threshold: 25_000, baseDuty: 435, marginalRate: 0.0225 },
      { upTo: 200_000, threshold: 75_000, baseDuty: 1_560, marginalRate: 0.035 },
      { upTo: 375_000, threshold: 200_000, baseDuty: 5_935, marginalRate: 0.04 },
      { upTo: 725_000, threshold: 375_000, baseDuty: 12_935, marginalRate: 0.0425 },
      { upTo: null, threshold: 725_000, baseDuty: 27_810, marginalRate: 0.045 }
    ],
    firstHomeConcession: {
      fullExemptionUpTo: 750_000,
      concessionEndsAt: 850_000
    },
    transferRegistrationFee: 203,
    mortgageRegistrationFee: 203,
    governmentSearchesFee: 340,
    defaultSolicitorFee: 2_150
  },
  NT: {
    stampDutyBrackets: [
      { upTo: 525_000, threshold: 0, baseDuty: 0, marginalRate: 0.023 },
      { upTo: 3_000_000, threshold: 525_000, baseDuty: 12_075, marginalRate: 0.0495 },
      { upTo: null, threshold: 3_000_000, baseDuty: 134_588, marginalRate: 0.057 }
    ],
    transferRegistrationFee: 168,
    mortgageRegistrationFee: 166,
    governmentSearchesFee: 295,
    defaultSolicitorFee: 2_050
  }
};

const DEFAULT_CALCULATOR_INPUTS = {
  state: 'NSW' as StateCode,
  purchasePrice: 900_000,
  depositPercent: 20,
  interestRate: 6.1,
  loanTermYears: 30,
  solicitorEstimate: STATE_COST_CONFIG.NSW.defaultSolicitorFee,
  buildingInspectionEstimate: 690,
  pestInspectionEstimate: 420,
  valuationEstimate: 390,
  movingEstimate: 2_100,
  otherEstimate: 1_500,
  firstHomeBuyer: false
};

@Component({
  selector: 'app-calculators-page',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, UIFormFieldComponent, UIButtonComponent],
  templateUrl: './calculators-page.component.html',
  styleUrl: './calculators-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CalculatorsPageComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mortgageChart') private mortgageChartElement?: ElementRef<HTMLCanvasElement>;

  readonly stateOptions = STATE_OPTIONS;

  selectedState: StateCode = DEFAULT_CALCULATOR_INPUTS.state;
  purchasePrice = DEFAULT_CALCULATOR_INPUTS.purchasePrice;
  depositPercent = DEFAULT_CALCULATOR_INPUTS.depositPercent;
  interestRate = DEFAULT_CALCULATOR_INPUTS.interestRate;
  loanTermYears = DEFAULT_CALCULATOR_INPUTS.loanTermYears;
  solicitorEstimate = DEFAULT_CALCULATOR_INPUTS.solicitorEstimate;
  buildingInspectionEstimate = DEFAULT_CALCULATOR_INPUTS.buildingInspectionEstimate;
  pestInspectionEstimate = DEFAULT_CALCULATOR_INPUTS.pestInspectionEstimate;
  valuationEstimate = DEFAULT_CALCULATOR_INPUTS.valuationEstimate;
  movingEstimate = DEFAULT_CALCULATOR_INPUTS.movingEstimate;
  otherEstimate = DEFAULT_CALCULATOR_INPUTS.otherEstimate;
  firstHomeBuyer = DEFAULT_CALCULATOR_INPUTS.firstHomeBuyer;

  stampDutyEstimate = 0;
  transferRegistrationFee = 0;
  mortgageRegistrationFee = 0;
  governmentSearchesFee = 0;
  depositAmount = 0;
  loanAmount = 0;
  lendersMortgageInsuranceEstimate = 0;
  monthlyRepayment = 0;
  totalInterestEstimate = 0;
  cashRequiredEstimate = 0;
  governmentFeesTotal = 0;
  professionalFeesTotal = 0;

  projectionTableRows: MortgageProjectionPoint[] = [];

  private mortgageChart?: Chart<'line', number[], string>;
  private chartLibraryPromise: Promise<typeof import('chart.js/auto')> | null = null;
  private chartRenderToken = 0;

  private readonly currencyFormatter = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0
  });

  constructor() {
    this.recalculateAll();
  }

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.renderOrUpdateChart();
  }

  ngOnDestroy(): void {
    this.mortgageChart?.destroy();
  }

  onStateChanged(nextState: StateCode): void {
    this.selectedState = nextState;
    this.solicitorEstimate = STATE_COST_CONFIG[nextState].defaultSolicitorFee;
    this.recalculateAll();
  }

  onInputChanged(): void {
    this.recalculateAll();
  }

  resetToDefaults(): void {
    this.selectedState = DEFAULT_CALCULATOR_INPUTS.state;
    this.purchasePrice = DEFAULT_CALCULATOR_INPUTS.purchasePrice;
    this.depositPercent = DEFAULT_CALCULATOR_INPUTS.depositPercent;
    this.interestRate = DEFAULT_CALCULATOR_INPUTS.interestRate;
    this.loanTermYears = DEFAULT_CALCULATOR_INPUTS.loanTermYears;
    this.solicitorEstimate = DEFAULT_CALCULATOR_INPUTS.solicitorEstimate;
    this.buildingInspectionEstimate = DEFAULT_CALCULATOR_INPUTS.buildingInspectionEstimate;
    this.pestInspectionEstimate = DEFAULT_CALCULATOR_INPUTS.pestInspectionEstimate;
    this.valuationEstimate = DEFAULT_CALCULATOR_INPUTS.valuationEstimate;
    this.movingEstimate = DEFAULT_CALCULATOR_INPUTS.movingEstimate;
    this.otherEstimate = DEFAULT_CALCULATOR_INPUTS.otherEstimate;
    this.firstHomeBuyer = DEFAULT_CALCULATOR_INPUTS.firstHomeBuyer;
    this.recalculateAll();
  }

  private recalculateAll(): void {
    this.purchasePrice = this.normalizeNumber(this.purchasePrice, DEFAULT_CALCULATOR_INPUTS.purchasePrice, 50_000, 20_000_000);
    this.depositPercent = this.normalizeNumber(this.depositPercent, DEFAULT_CALCULATOR_INPUTS.depositPercent, 0, 95);
    this.interestRate = this.normalizeNumber(this.interestRate, DEFAULT_CALCULATOR_INPUTS.interestRate, 0, 20);
    this.loanTermYears = Math.round(this.normalizeNumber(this.loanTermYears, DEFAULT_CALCULATOR_INPUTS.loanTermYears, 5, 40));
    this.solicitorEstimate = this.normalizeNumber(this.solicitorEstimate, STATE_COST_CONFIG[this.selectedState].defaultSolicitorFee, 500, 50_000);
    this.buildingInspectionEstimate = this.normalizeNumber(
      this.buildingInspectionEstimate,
      DEFAULT_CALCULATOR_INPUTS.buildingInspectionEstimate,
      0,
      10_000
    );
    this.pestInspectionEstimate = this.normalizeNumber(this.pestInspectionEstimate, DEFAULT_CALCULATOR_INPUTS.pestInspectionEstimate, 0, 10_000);
    this.valuationEstimate = this.normalizeNumber(this.valuationEstimate, DEFAULT_CALCULATOR_INPUTS.valuationEstimate, 0, 10_000);
    this.movingEstimate = this.normalizeNumber(this.movingEstimate, DEFAULT_CALCULATOR_INPUTS.movingEstimate, 0, 50_000);
    this.otherEstimate = this.normalizeNumber(this.otherEstimate, DEFAULT_CALCULATOR_INPUTS.otherEstimate, 0, 100_000);

    const config = STATE_COST_CONFIG[this.selectedState];
    this.stampDutyEstimate = Math.round(this.calculateStampDuty(this.purchasePrice, config));
    this.transferRegistrationFee = config.transferRegistrationFee;
    this.mortgageRegistrationFee = config.mortgageRegistrationFee;
    this.governmentSearchesFee = config.governmentSearchesFee;

    this.depositAmount = Math.round(this.purchasePrice * (this.depositPercent / 100));
    this.loanAmount = Math.max(0, Math.round(this.purchasePrice - this.depositAmount));
    this.lendersMortgageInsuranceEstimate = Math.round(this.estimateLmi(this.loanAmount, this.purchasePrice));

    const projection = this.buildMortgageProjection(this.loanAmount, this.interestRate, this.loanTermYears);
    this.projectionTableRows = projection;

    const lastProjection = projection[projection.length - 1];
    this.totalInterestEstimate = Math.round(lastProjection?.cumulativeInterest ?? 0);
    this.monthlyRepayment = Math.round(this.calculateMonthlyRepayment(this.loanAmount, this.interestRate, this.loanTermYears));

    this.governmentFeesTotal =
      this.stampDutyEstimate + this.transferRegistrationFee + this.mortgageRegistrationFee + this.governmentSearchesFee;
    this.professionalFeesTotal =
      this.solicitorEstimate +
      this.buildingInspectionEstimate +
      this.pestInspectionEstimate +
      this.valuationEstimate +
      this.movingEstimate +
      this.otherEstimate;

    this.cashRequiredEstimate = Math.round(
      this.depositAmount + this.governmentFeesTotal + this.professionalFeesTotal + this.lendersMortgageInsuranceEstimate
    );

    this.renderOrUpdateChart();
  }

  private normalizeNumber(value: number, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
  }

  private calculateStampDuty(purchasePrice: number, config: StateCostConfig): number {
    let estimate = 0;

    for (const bracket of config.stampDutyBrackets) {
      if (bracket.upTo === null || purchasePrice <= bracket.upTo) {
        estimate = bracket.baseDuty + (purchasePrice - bracket.threshold) * bracket.marginalRate;
        break;
      }
    }

    if (!this.firstHomeBuyer || !config.firstHomeConcession) {
      return Math.max(0, estimate);
    }

    const { fullExemptionUpTo, concessionEndsAt } = config.firstHomeConcession;
    if (purchasePrice <= fullExemptionUpTo) {
      return 0;
    }

    if (purchasePrice >= concessionEndsAt) {
      return Math.max(0, estimate);
    }

    const taperRatio = (purchasePrice - fullExemptionUpTo) / (concessionEndsAt - fullExemptionUpTo);
    return Math.max(0, estimate * (1 - taperRatio));
  }

  private estimateLmi(loanAmount: number, purchasePrice: number): number {
    if (loanAmount <= 0 || purchasePrice <= 0) {
      return 0;
    }

    const lvr = loanAmount / purchasePrice;

    if (lvr < 0.8) {
      return 0;
    }

    if (lvr < 0.8) {
      return loanAmount * 0.009;
    }

    if (lvr < 0.9) {
      return loanAmount * 0.018;
    }

    if (lvr < 0.95) {
      return loanAmount * 0.028;
    }

    return loanAmount * 0.038;
  }

  private calculateMonthlyRepayment(loanAmount: number, annualRatePercent: number, termYears: number): number {
    if (loanAmount <= 0) {
      return 0;
    }

    const months = Math.max(1, Math.round(termYears * 12));
    const monthlyRate = annualRatePercent / 12 / 100;

    if (monthlyRate === 0) {
      return loanAmount / months;
    }

    const factor = Math.pow(1 + monthlyRate, months);
    return (loanAmount * monthlyRate * factor) / (factor - 1);
  }

  private buildMortgageProjection(loanAmount: number, annualRatePercent: number, termYears: number): MortgageProjectionPoint[] {
    if (loanAmount <= 0) {
      return [
        {
          label: 'Year 0',
          remainingBalance: 0,
          cumulativePrincipal: 0,
          cumulativeInterest: 0
        }
      ];
    }

    const months = Math.max(1, Math.round(termYears * 12));
    const monthlyRate = annualRatePercent / 12 / 100;
    const monthlyRepayment = this.calculateMonthlyRepayment(loanAmount, annualRatePercent, termYears);

    let remainingBalance = loanAmount;
    let cumulativePrincipal = 0;
    let cumulativeInterest = 0;

    const points: MortgageProjectionPoint[] = [
      {
        label: 'Year 0',
        remainingBalance,
        cumulativePrincipal,
        cumulativeInterest
      }
    ];

    for (let month = 1; month <= months; month++) {
      const interestPart = monthlyRate === 0 ? 0 : remainingBalance * monthlyRate;
      const principalPart = Math.min(remainingBalance, Math.max(0, monthlyRepayment - interestPart));

      remainingBalance = Math.max(0, remainingBalance - principalPart);
      cumulativePrincipal += principalPart;
      cumulativeInterest += interestPart;

      if (month % 12 === 0 || month === months) {
        points.push({
          label: `Year ${Math.ceil(month / 12)}`,
          remainingBalance,
          cumulativePrincipal,
          cumulativeInterest
        });
      }
    }

    return points;
  }

  private renderOrUpdateChart(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const renderToken = ++this.chartRenderToken;
    void this.renderOrUpdateChartAsync(renderToken);
  }

  private async renderOrUpdateChartAsync(renderToken: number): Promise<void> {
    const canvas = this.mortgageChartElement?.nativeElement;
    if (!canvas) {
      return;
    }

    const labels = this.projectionTableRows.map((point) => point.label);
    const remainingBalances = this.projectionTableRows.map((point) => Math.round(point.remainingBalance));
    const cumulativePrincipal = this.projectionTableRows.map((point) => Math.round(point.cumulativePrincipal));
    const cumulativeInterest = this.projectionTableRows.map((point) => Math.round(point.cumulativeInterest));

    const { Chart } = await this.getChartLibrary();
    if (renderToken !== this.chartRenderToken || !canvas.isConnected) {
      return;
    }

    if (!this.mortgageChart) {
      this.mortgageChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Remaining balance',
              data: remainingBalances,
              borderColor: '#0b3c5d',
              backgroundColor: 'rgba(11, 60, 93, 0.16)',
              fill: true,
              tension: 0.24,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4
            },
            {
              label: 'Principal repaid',
              data: cumulativePrincipal,
              borderColor: '#2d7c4f',
              backgroundColor: 'rgba(45, 124, 79, 0.13)',
              fill: true,
              tension: 0.24,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4
            },
            {
              label: 'Cumulative interest',
              data: cumulativeInterest,
              borderColor: '#a96514',
              borderDash: [6, 4],
              fill: false,
              tension: 0.2,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 900,
            easing: 'easeOutQuart'
          },
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                usePointStyle: true,
                pointStyle: 'line'
              }
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const value = context.parsed.y ?? 0;
                  return `${context.dataset.label}: ${this.currencyFormatter.format(value)}`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: {
                color: 'rgba(11, 60, 93, 0.08)'
              }
            },
            y: {
              grid: {
                color: 'rgba(11, 60, 93, 0.08)'
              },
              ticks: {
                callback: (value) => this.currencyFormatter.format(Number(value))
              }
            }
          }
        }
      });
      return;
    }

    this.mortgageChart.data.labels = labels;
    this.mortgageChart.data.datasets[0].data = remainingBalances;
    this.mortgageChart.data.datasets[1].data = cumulativePrincipal;
    this.mortgageChart.data.datasets[2].data = cumulativeInterest;
    this.mortgageChart.update();
  }

  private getChartLibrary(): Promise<typeof import('chart.js/auto')> {
    if (!this.chartLibraryPromise) {
      this.chartLibraryPromise = import('chart.js/auto');
    }

    return this.chartLibraryPromise;
  }
}
