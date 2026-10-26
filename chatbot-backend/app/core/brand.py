"""
Who this assistant works for. This deployment is for SmartBusiness Solutions
only, so the identity lives here as plain constants (no env settings).
Used in the refusal message, greeting, system prompt and NeMo guard policy.
"""
COMPANY_NAME = "SmartBusiness Solutions"
TOPICS = "Check Printing and Time & Attendance"
COMPANY_SUMMARY = (
    "a business software company whose products are Check Printing "
    "(prepare, approve and print business checks) and Time and Attendance "
    "(employee clock-in/out, geofencing, attendance reports)"
)
