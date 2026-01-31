# Loan Reporting – User Guide

## General Setup
The loan reporting platform uses this Admin page to create loans, 
add loan events (prepayment, deferrals, defaults), manage the fees 
paid by the users, and (future) manage the users on the platform.
The user of this platform can select the user whose portfolio they 
want to see and visit the ROI, Earnings, and Amort Schedule pages.
The main Reporting Portal page allows user selection, also.
The ROI, Earnings, and Amort pages are primarily UI pages, and 
logic is controled by shared .js files.

Loans can be owned by multiple users in increments of 5% Lots.
Each UI page shows the % ownership for each loan.

---

## What the Admin page controls
The Loan Admin page drives all data used by the ROI, Earnings,
and Amortization views.

Changes here affect all downstream calculations.

Add loans (or duplicate them) by filling out all fields and 
clicking Save - the page will notlet you exit without saving.

Change Fees by clicking Fee Management and updating the setup fee
and/or the monthly servicing fee.  Monthly fees are based on the
remaining balance (default is 25 bps or 0.25%).  Dewfault setup fee 
is $150/loan.

Fee Waivers can be applied to any user based on the following:
- No fee waivers (default)
- All Fees Waived (active)
- Setup Fee Only Waived
- Setup + Grace/Deferral Waived
- Grace/Deferral Only Waived

User Management is for possible future use.

---

## Saving changes
Edits are local until **Save Changes** is clicked.
Leaving the page without saving will discard edits but
should trigger a browser warning that you have not saved
changes yet.

Adding ownership lots can be saved by clicking Save and Close
in the Ownership Drawer and the main Admin page Save button will 
not need to be used.

---

## Adding/Editing loans
- All fields are required to add a loan
- Loan ID is randomly generated
- Loan name: school initials_loan year_rate
- Owner, purchase price, lots purchased are assigned by clicking 
- Loan fee waivers override user fee waivers
- Changes take effect immediately after saving

---

## Ownership
Ownership determines how earnings are split across users.

Click the ownership pill to:
- Add owners
- Adjust percentages
- View historical changes

Ownership must total **100%**.

---

## Feedback
Each page has a feedback bubble in the lower right - leave any 
comment or question and Jeff will try to reply quickly.
Leave as much info as possible to help with trouble shooting.


