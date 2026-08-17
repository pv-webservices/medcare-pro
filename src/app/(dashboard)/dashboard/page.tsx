import { 
  Building2, 
  Stethoscope, 
  Users, 
  Calendar, 
  Bell, 
  MessageSquare,
  ArrowUpRight,
  ChevronDown
} from "lucide-react";
import Image from "next/image";

// Live dashboard — PRD §6.4 (FR-4.1 … FR-4.3). Stage 2. 
// Uses static layout mirroring the reference design.

export default function DashboardPage() {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            Welcome back, Admin! 👋
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Here's what's happening with your clinics today.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm border border-slate-100">
          <Calendar className="h-4 w-4 text-slate-400" />
          {today}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {/* Card 1 */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Building2 className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Clinics</p>
              <h3 className="text-2xl font-bold text-slate-900 mt-1">24</h3>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
              <ArrowUpRight className="h-3 w-3" />
              12%
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-50">Active clinics</p>
        </div>

        {/* Card 2 */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Stethoscope className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Doctors</p>
              <h3 className="text-2xl font-bold text-slate-900 mt-1">146</h3>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
              <ArrowUpRight className="h-3 w-3" />
              8%
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-50">Active doctors</p>
        </div>

        {/* Card 3 */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Users className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Patients</p>
              <h3 className="text-2xl font-bold text-slate-900 mt-1">1,843</h3>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
              <ArrowUpRight className="h-3 w-3" />
              15%
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-50">Registered patients</p>
        </div>

        {/* Card 4 */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Calendar className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Appointments</p>
              <h3 className="text-2xl font-bold text-slate-900 mt-1">532</h3>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
              <ArrowUpRight className="h-3 w-3" />
              10%
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-50">This month</p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column (2 spans) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Chart Section */}
          <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-base font-bold text-slate-900">Appointments Overview</h3>
              <div className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer hover:text-slate-900 transition-colors">
                This Month <ChevronDown className="h-4 w-4" />
              </div>
            </div>
            
            {/* Legend */}
            <div className="flex items-center gap-6 mb-8 text-xs font-medium text-slate-500">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-sm bg-violet-600"></div>
                Completed
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-sm bg-violet-200"></div>
                Pending
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-sm bg-slate-200"></div>
                Cancelled
              </div>
            </div>

            {/* Mock Chart Area */}
            <div className="relative h-64 w-full flex items-end justify-between gap-2 px-2">
              {/* Chart lines */}
              <div className="absolute inset-0 flex flex-col justify-between border-b border-slate-100 pb-6 pointer-events-none">
                <div className="border-t border-slate-100 w-full flex-1"></div>
                <div className="border-t border-slate-100 w-full flex-1"></div>
                <div className="border-t border-slate-100 w-full flex-1"></div>
                <div className="border-t border-slate-100 w-full flex-1"></div>
              </div>
              
              {/* Y-axis labels */}
              <div className="absolute left-0 top-0 bottom-6 flex flex-col justify-between text-[10px] font-medium text-slate-400">
                <span>200</span>
                <span>150</span>
                <span>100</span>
                <span>50</span>
                <span>0</span>
              </div>

              {/* Bars */}
              <div className="ml-8 w-full flex items-end justify-around h-[calc(100%-24px)] z-10">
                {/* Bar 1 */}
                <div className="relative flex flex-col justify-end w-8 h-[60%] group">
                  <div className="w-full bg-slate-200 rounded-t-sm h-[20%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-200 h-[30%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-600 rounded-b-sm h-[50%] transition-opacity group-hover:opacity-80"></div>
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-medium text-slate-500 whitespace-nowrap">May 16</span>
                </div>
                {/* Bar 2 */}
                <div className="relative flex flex-col justify-end w-8 h-[55%] group">
                  <div className="w-full bg-slate-200 rounded-t-sm h-[25%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-200 h-[25%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-600 rounded-b-sm h-[50%] transition-opacity group-hover:opacity-80"></div>
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-medium text-slate-500 whitespace-nowrap">May 17</span>
                </div>
                {/* Bar 3 */}
                <div className="relative flex flex-col justify-end w-8 h-[80%] group">
                  <div className="w-full bg-slate-200 rounded-t-sm h-[15%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-200 h-[35%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-600 rounded-b-sm h-[50%] transition-opacity group-hover:opacity-80"></div>
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-medium text-slate-500 whitespace-nowrap">May 18</span>
                </div>
                {/* Bar 4 */}
                <div className="relative flex flex-col justify-end w-8 h-[65%] group">
                  <div className="w-full bg-slate-200 rounded-t-sm h-[20%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-200 h-[40%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-600 rounded-b-sm h-[40%] transition-opacity group-hover:opacity-80"></div>
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-medium text-slate-500 whitespace-nowrap">May 19</span>
                </div>
                {/* Bar 5 */}
                <div className="relative flex flex-col justify-end w-8 h-[58%] group">
                  <div className="w-full bg-slate-200 rounded-t-sm h-[10%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-200 h-[40%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-600 rounded-b-sm h-[50%] transition-opacity group-hover:opacity-80"></div>
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-medium text-slate-500 whitespace-nowrap">May 20</span>
                </div>
                {/* Bar 6 */}
                <div className="relative flex flex-col justify-end w-8 h-[62%] group">
                  <div className="w-full bg-slate-200 rounded-t-sm h-[15%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-200 h-[35%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-600 rounded-b-sm h-[50%] transition-opacity group-hover:opacity-80"></div>
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-medium text-slate-500 whitespace-nowrap">May 21</span>
                </div>
                {/* Bar 7 */}
                <div className="relative flex flex-col justify-end w-8 h-[85%] group">
                  <div className="w-full bg-slate-200 rounded-t-sm h-[20%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-200 h-[35%] transition-opacity group-hover:opacity-80"></div>
                  <div className="w-full bg-violet-600 rounded-b-sm h-[45%] transition-opacity group-hover:opacity-80"></div>
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-medium text-slate-900 font-bold whitespace-nowrap">May 22</span>
                </div>
              </div>
            </div>
          </div>

          {/* Notifications List */}
          <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-base font-bold text-slate-900">Notifications</h3>
              <div className="text-sm font-medium text-violet-600 cursor-pointer hover:text-violet-700 transition-colors">
                View all
              </div>
            </div>
            
            <div className="space-y-6">
              {/* Notif 1 */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                  <Bell className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <p className="text-sm font-bold text-slate-900">New clinic registration</p>
                    <span className="text-xs font-medium text-slate-400 whitespace-nowrap ml-2">10 min ago</span>
                  </div>
                  <p className="text-sm text-slate-500 truncate">City Smiles Clinic has been registered successfully.</p>
                </div>
              </div>
              
              {/* Notif 2 */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
                  <Users className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <p className="text-sm font-bold text-slate-900">Appointment updated</p>
                    <span className="text-xs font-medium text-slate-400 whitespace-nowrap ml-2">1 hr ago</span>
                  </div>
                  <p className="text-sm text-slate-500 truncate">Appointment #APT-1452 has been rescheduled.</p>
                </div>
              </div>
              
              {/* Notif 3 */}
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <p className="text-sm font-bold text-slate-900">New message received</p>
                    <span className="text-xs font-medium text-slate-400 whitespace-nowrap ml-2">2 hrs ago</span>
                  </div>
                  <p className="text-sm text-slate-500 truncate">You have a new message from Bright Dental Care.</p>
                </div>
              </div>
            </div>
          </div>
          
        </div>
        
        {/* Right Column (1 span) */}
        <div className="space-y-8">
          
          {/* Recent Registrations */}
          <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-base font-bold text-slate-900">Recent Registrations</h3>
              <div className="text-sm font-medium text-violet-600 cursor-pointer hover:text-violet-700 transition-colors">
                View all
              </div>
            </div>
            
            <div className="space-y-6">
              {/* Reg 1 */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <img src="https://ui-avatars.com/api/?name=C+S&background=e0e7ff&color=4f46e5&size=128" alt="Clinic" className="h-10 w-10 rounded-full object-cover" />
                  <div>
                    <p className="text-sm font-bold text-slate-900">City Smiles Clinic</p>
                    <p className="text-xs text-slate-500 mt-0.5">Registered on May 22, 2025</p>
                  </div>
                </div>
                <div className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                  Active
                </div>
              </div>
              
              {/* Reg 2 */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <img src="https://ui-avatars.com/api/?name=B+D&background=dcfce7&color=16a34a&size=128" alt="Clinic" className="h-10 w-10 rounded-full object-cover" />
                  <div>
                    <p className="text-sm font-bold text-slate-900">Bright Dental Care</p>
                    <p className="text-xs text-slate-500 mt-0.5">Registered on May 21, 2025</p>
                  </div>
                </div>
                <div className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                  Active
                </div>
              </div>
              
              {/* Reg 3 */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <img src="https://ui-avatars.com/api/?name=H+T&background=fef3c7&color=d97706&size=128" alt="Clinic" className="h-10 w-10 rounded-full object-cover" />
                  <div>
                    <p className="text-sm font-bold text-slate-900">Healthy Teeth Clinic</p>
                    <p className="text-xs text-slate-500 mt-0.5">Registered on May 21, 2025</p>
                  </div>
                </div>
                <div className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                  Active
                </div>
              </div>
              
              {/* Reg 4 */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <img src="https://ui-avatars.com/api/?name=S+Z&background=fce7f3&color=db2777&size=128" alt="Clinic" className="h-10 w-10 rounded-full object-cover" />
                  <div>
                    <p className="text-sm font-bold text-slate-900">Smile Zone</p>
                    <p className="text-xs text-slate-500 mt-0.5">Registered on May 20, 2025</p>
                  </div>
                </div>
                <div className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                  Active
                </div>
              </div>
            </div>
          </div>
          
          {/* Promo Card */}
          <div className="rounded-3xl bg-violet-50 p-8 shadow-sm border border-violet-100 overflow-hidden relative">
            <div className="relative z-10 w-[60%]">
              <h3 className="text-xl font-bold text-slate-900 leading-tight mb-3">
                Delivering better care, every day.
              </h3>
              <p className="text-sm text-slate-600 mb-6">
                Manage your clinics, doctors and patients all in one place.
              </p>
              <button className="rounded-xl bg-[#6B46C1] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#5a3aa6] transition-colors">
                Explore Features
              </button>
            </div>
            <div className="absolute -bottom-4 -right-12 h-[120%] w-[80%] pointer-events-none">
              <Image 
                src="/clinic-bg-generic.jpg" 
                alt="Doctors"
                fill
                className="object-cover object-left opacity-30 mix-blend-multiply rounded-l-full"
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
